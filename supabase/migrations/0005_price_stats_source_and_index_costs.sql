-- Two corrections to the reporting views.
--
-- 1. material_price_stats mixed price sources. `price_points` carries the
--    tracked FRED series *and* the invoice prices a shop records by hand, and
--    the view ranked them together — so recording what you paid replaced the
--    market price with your own, and the 7d/30d change was computed across two
--    unrelated price bases. A $1.50/ft invoice against a lumber index sitting
--    at 286 reads as a 99.5% crash, and the alert worker duly raised one.
--
--    Where a material is mapped to a series, that series is what the stats
--    describe. Manual prices remain in price_points and are still charted
--    alongside; they just no longer masquerade as the market.
--
-- 2. product_costs multiplied index levels into dollar costs. 0004 added
--    `price_is_index` precisely so nothing would ("Index-quoted series have no
--    absolute price... nothing multiplies an index value into a cost"), and the
--    material page, the price chart and the RAG synthesiser all honour it —
--    but this view predates the column and was never revisited. Most of the
--    seeded catalogue is PPI indexes (steel, plastics, paper, lumber, glass,
--    cement), so this reached the majority of materials.
--
--    An index-priced material now contributes nothing to the cost and is
--    counted as unpriced, which is what it is. The existing convention of
--    treating an unpriced material as zero is left alone, so a product whose
--    inputs are all indexes reports a batch_cost of 0 with every line flagged
--    in unpriced_material_count — the signal the dashboard already reads.
--
-- Both are `create or replace`: the column names, types and order are
-- unchanged, only the rows they compute. Replace material_price_stats first —
-- product_costs selects from it.

-- ---------------------------------------------------------------------------
-- material_price_stats: report the tracked series, not the invoice book
-- ---------------------------------------------------------------------------
create or replace view public.material_price_stats
with (security_invoker = true) as
with ranked as (
  select
    pp.material_id,
    pp.price,
    pp.currency,
    pp.observed_on,
    row_number() over (partition by pp.material_id order by pp.observed_on desc) as rn
  from public.price_points pp
  join public.materials m on m.id = pp.material_id
  -- A mapped material is described by its series. An unmapped one has nothing
  -- else to report, so whatever was recorded by hand still shows.
  where m.fred_series_id is null or pp.source = 'fred'
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
-- The lookbacks need the same filter as `latest`: the manual-price form takes
-- an arbitrary date, so a backdated invoice would otherwise still be picked up
-- as the comparison point even with the latest price clean.
left join lateral (
  select pp.price from public.price_points pp
  where pp.material_id = m.id
    and pp.observed_on <= l.observed_on - 7
    and (m.fred_series_id is null or pp.source = 'fred')
  order by pp.observed_on desc limit 1
) w on true
left join lateral (
  select pp.price from public.price_points pp
  where pp.material_id = m.id
    and pp.observed_on <= l.observed_on - 30
    and (m.fred_series_id is null or pp.source = 'fred')
  order by pp.observed_on desc limit 1
) mo on true;

-- ---------------------------------------------------------------------------
-- product_costs: an index level is not money
-- ---------------------------------------------------------------------------
create or replace view public.product_costs
with (security_invoker = true) as
with lines as (
  select
    p.id            as product_id,
    p.user_id,
    p.name,
    p.units_per_batch,
    b.id            as bom_item_id,
    b.quantity,
    -- Normalising an index to null up front keeps the aggregates below
    -- identical to the ordinary unpriced-material path.
    case when m.price_is_index then null else s.latest_price   end as latest_price,
    case when m.price_is_index then null else s.price_30d_ago  end as price_30d_ago
  from public.products p
  left join public.bom_items b            on b.product_id = p.id
  left join public.materials m            on m.id = b.material_id
  left join public.material_price_stats s on s.material_id = b.material_id
)
select
  product_id,
  user_id,
  name,
  units_per_batch,
  count(bom_item_id)                                       as material_count,
  count(bom_item_id) filter (where latest_price is null)   as unpriced_material_count,
  round(sum(quantity * coalesce(latest_price, 0)), 4)      as batch_cost,
  round(sum(quantity * coalesce(latest_price, 0))
        / nullif(units_per_batch, 0), 4)                   as unit_cost,
  round(sum(quantity * coalesce(price_30d_ago, latest_price, 0))
        / nullif(units_per_batch, 0), 4)                   as unit_cost_30d_ago
from lines
group by product_id, user_id, name, units_per_batch;
