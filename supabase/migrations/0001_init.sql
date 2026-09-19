-- Better RAW — initial schema
-- Raw material price tracking with per-user (per-business) isolation via RLS.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated business account
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  company_name  text,
  timezone      text not null default 'America/New_York',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- fred_series: catalog of candidate FRED series the LLM mapper picks from.
-- Public read; only the service role writes.
-- ---------------------------------------------------------------------------
create table public.fred_series (
  series_id   text primary key,
  title       text not null,
  units       text,
  frequency   text,
  keywords    text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- materials: the raw materials a business inputs
-- ---------------------------------------------------------------------------
create type public.price_source as enum ('fred', 'manual', 'supplier');

create table public.materials (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  name                text not null,
  category            text,
  unit                text not null default 'kg',
  sku                 text,
  supplier            text,
  notes               text,
  currency            text not null default 'USD',
  -- Baseline price the business paid; price_points carry the tracked series.
  baseline_price      numeric(14, 4),
  -- Set by the Python/Claude mapper; null means "not mapped yet".
  fred_series_id      text references public.fred_series (series_id) on delete set null,
  fred_confidence     numeric(3, 2),
  fred_mapped_at      timestamptz,
  tracking            boolean not null default true,
  alert_threshold_pct numeric(5, 2) not null default 5.00,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint materials_name_not_blank check (length(btrim(name)) > 0)
);

create index materials_user_id_idx on public.materials (user_id);
create index materials_fred_series_idx on public.materials (fred_series_id)
  where fred_series_id is not null;
create unique index materials_user_name_key on public.materials (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- price_points: time series of observed prices per material
-- ---------------------------------------------------------------------------
create table public.price_points (
  id           bigint generated always as identity primary key,
  material_id  uuid not null references public.materials (id) on delete cascade,
  observed_on  date not null,
  price        numeric(14, 4) not null,
  currency     text not null default 'USD',
  source       public.price_source not null default 'fred',
  created_at   timestamptz not null default now(),
  unique (material_id, observed_on, source)
);

create index price_points_material_date_idx
  on public.price_points (material_id, observed_on desc);

-- ---------------------------------------------------------------------------
-- products + bill of materials
-- ---------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  sku          text,
  units_per_batch numeric(14, 4) not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_user_id_idx on public.products (user_id);

create table public.bom_items (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  material_id  uuid not null references public.materials (id) on delete restrict,
  quantity     numeric(14, 4) not null check (quantity > 0),
  unit         text not null default 'kg',
  created_at   timestamptz not null default now(),
  unique (product_id, material_id)
);

create index bom_items_material_idx on public.bom_items (material_id);

-- ---------------------------------------------------------------------------
-- push notifications
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_prefs (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  enabled           boolean not null default false,
  min_change_pct    numeric(5, 2) not null default 5.00,
  digest            text not null default 'daily'
                      check (digest in ('instant', 'daily', 'weekly')),
  quiet_hours_start smallint not null default 21 check (quiet_hours_start between 0 and 23),
  quiet_hours_end   smallint not null default 7 check (quiet_hours_end between 0 and 23),
  updated_at        timestamptz not null default now()
);

-- Generated price-move alerts. The Python worker writes these (Claude authors
-- headline/body/drivers); the Next.js dispatcher fans them out over web-push.
create table public.alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  material_id   uuid not null references public.materials (id) on delete cascade,
  kind          text not null check (kind in ('spike', 'dip')),
  window_days   integer not null default 7,
  pct_change    numeric(8, 3) not null,
  price_before  numeric(14, 4) not null,
  price_after   numeric(14, 4) not null,
  headline      text not null,
  body          text not null,
  -- [{ "driver": "...", "detail": "...", "source": "..." }]
  drivers       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  read_at       timestamptz
);

create index alerts_user_created_idx on public.alerts (user_id, created_at desc);
create index alerts_undelivered_idx on public.alerts (created_at)
  where delivered_at is null;

-- ---------------------------------------------------------------------------
-- Views: latest price + trailing change per material
-- ---------------------------------------------------------------------------
create view public.material_price_stats
with (security_invoker = true) as
with ranked as (
  select
    pp.material_id,
    pp.price,
    pp.currency,
    pp.observed_on,
    row_number() over (partition by pp.material_id order by pp.observed_on desc) as rn
  from public.price_points pp
),
latest as (
  select material_id, price, currency, observed_on from ranked where rn = 1
)
select
  m.id as material_id,
  m.user_id,
  m.name,
  m.unit,
  coalesce(l.currency, m.currency) as currency,
  l.price        as latest_price,
  l.observed_on  as latest_observed_on,
  w.price        as price_7d_ago,
  mo.price       as price_30d_ago,
  case when w.price is not null and w.price <> 0
       then round(((l.price - w.price) / w.price) * 100, 3) end as change_7d_pct,
  case when mo.price is not null and mo.price <> 0
       then round(((l.price - mo.price) / mo.price) * 100, 3) end as change_30d_pct
from public.materials m
left join latest l on l.material_id = m.id
left join lateral (
  select pp.price from public.price_points pp
  where pp.material_id = m.id and pp.observed_on <= l.observed_on - 7
  order by pp.observed_on desc limit 1
) w on true
left join lateral (
  select pp.price from public.price_points pp
  where pp.material_id = m.id and pp.observed_on <= l.observed_on - 30
  order by pp.observed_on desc limit 1
) mo on true;

-- BOM cost rollup: unit cost of each product at the latest tracked prices.
create view public.product_costs
with (security_invoker = true) as
select
  p.id      as product_id,
  p.user_id,
  p.name,
  p.units_per_batch,
  count(b.id)                                          as material_count,
  count(b.id) filter (where s.latest_price is null)    as unpriced_material_count,
  round(sum(b.quantity * coalesce(s.latest_price, 0)), 4) as batch_cost,
  round(sum(b.quantity * coalesce(s.latest_price, 0)) / nullif(p.units_per_batch, 0), 4) as unit_cost,
  round(sum(b.quantity * coalesce(s.price_30d_ago, s.latest_price, 0)) / nullif(p.units_per_batch, 0), 4) as unit_cost_30d_ago
from public.products p
left join public.bom_items b on b.product_id = p.id
left join public.material_price_stats s on s.material_id = b.material_id
group by p.id, p.user_id, p.name, p.units_per_batch;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger materials_touch before update on public.materials
  for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

-- New signups get a profile and default (opted-out) notification prefs.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, company_name)
  values (new.id, new.raw_user_meta_data ->> 'company_name')
  on conflict (id) do nothing;

  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.fred_series         enable row level security;
alter table public.materials           enable row level security;
alter table public.price_points        enable row level security;
alter table public.products            enable row level security;
alter table public.bom_items           enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.notification_prefs  enable row level security;
alter table public.alerts              enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "fred series readable" on public.fred_series
  for select to authenticated using (true);

create policy "own materials" on public.materials
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own products" on public.products
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own notification prefs" on public.notification_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Alerts are authored by the worker; users read and mark them read.
create policy "own alerts readable" on public.alerts
  for select to authenticated using (user_id = auth.uid());
create policy "own alerts updatable" on public.alerts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Child tables inherit ownership through their parent.
create policy "own price points" on public.price_points
  for all to authenticated
  using (exists (
    select 1 from public.materials m
    where m.id = price_points.material_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.materials m
    where m.id = price_points.material_id and m.user_id = auth.uid()
  ));

create policy "own bom items" on public.bom_items
  for all to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = bom_items.product_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.products p
    where p.id = bom_items.product_id and p.user_id = auth.uid()
  ));
