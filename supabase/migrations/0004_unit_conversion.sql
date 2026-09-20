-- Normalise FRED prices into each shop's own purchasing unit.
--
-- FRED quotes aluminum in dollars per metric ton; a shop buys 6061 by the
-- pound. Prices are converted at sync time, so `price_points.price` is always
-- in `materials.currency` per `materials.unit` and every downstream view can
-- multiply it by a BOM quantity without further thought.
--
-- Index-quoted series (PPI and friends) have no absolute price. They are still
-- tracked for percentage moves, but `price_is_index` marks them so nothing
-- multiplies an index value into a cost.

alter table materials
  add column if not exists price_factor numeric not null default 1,
  add column if not exists price_native_unit text,
  add column if not exists price_is_index boolean not null default false;

comment on column materials.price_factor is
  'Multiply a raw observation from the mapped FRED series by this to get price per materials.unit.';
comment on column materials.price_native_unit is
  'The unit the FRED series is quoted in, e.g. "metric ton". For display and debugging.';
comment on column materials.price_is_index is
  'True when the series is an index, so price is relative and must not be multiplied into a cost.';