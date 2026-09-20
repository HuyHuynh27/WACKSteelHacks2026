"""Pull FRED observations into price_points.

Incremental: each material resumes from its newest stored observation, so a
daily run fetches a handful of rows. A newly mapped material backfills
`backfill_days` of history in one go.

Observations are converted into the shop's own purchasing unit on the way in
(see units.py), so `price_points.price` is always in `materials.currency` per
`materials.unit`. The raw FRED value is never stored.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from . import db, fred
from .config import settings

log = logging.getLogger(__name__)

# Enough decimals for a cheap material quoted in a small unit (a gram of resin,
# a board foot of pine) without carrying float noise into Postgres.
PRICE_DECIMALS = 8


def _start_date(material_id: str) -> date:
    latest = db.latest_observation_date(material_id)
    if latest:
        # Re-fetch the last stored day too; FRED revises recent values.
        return date.fromisoformat(latest)
    # The job runs on a UTC schedule, so anchor the backfill window to UTC.
    today = datetime.now(timezone.utc).date()
    return today - timedelta(days=settings().backfill_days)


def _rows_for(material: dict, observations: list[fred.Observation]) -> list[dict]:
    # A material mapped before the conversion columns existed, or one whose
    # units couldn't be resolved, falls back to 1 and is stored as quoted.
    factor = float(material.get("price_factor") or 1)
    return [
        {
            "material_id": material["id"],
            "observed_on": observation.observed_on.isoformat(),
            "price": round(observation.value * factor, PRICE_DECIMALS),
            "currency": material.get("currency") or "USD",
            "source": "fred",
        }
        for observation in observations
    ]


def run() -> int:
    """Sync every tracked material. Returns total rows written."""
    materials = db.fetch_tracked_materials()
    if not materials:
        log.info("No tracked materials with a mapped series.")
        return 0

    # Different businesses often track the same series from the same date, so
    # cache each (series, start) fetch instead of hitting FRED once per row.
    cache: dict[tuple[str, date], list[fred.Observation]] = {}
    total = 0

    for material in materials:
        try:
            series_id = material["fred_series_id"]
            start = _start_date(material["id"])
            key = (series_id, start)

            if key not in cache:
                cache[key] = fred.get_observations(series_id, start=start)
            observations = cache[key]

            if not observations:
                log.info("%s (%s): nothing new", material["name"], series_id)
                continue

            rows = _rows_for(material, observations)
            written = db.upsert_price_points(rows)
            total += written

            factor = float(material.get("price_factor") or 1)
            latest = rows[-1]["price"]
            if material.get("price_is_index"):
                units_note = "index, unscaled"
                latest_note = "{:.6g} index pts".format(latest)
            else:
                latest_note = "{:.6g} {}/{}".format(
                    latest,
                    material.get("currency") or "USD",
                    material.get("unit") or "unit",
                )
                if factor == 1:
                    units_note = "as quoted"
                else:
                    units_note = "{} -> {}, x{:.6g}".format(
                        material.get("price_native_unit") or "?",
                        material.get("unit") or "?",
                        factor,
                    )

            log.info(
                "%s (%s): %d observations from %s [%s]; latest %s",
                material["name"],
                series_id,
                written,
                start.isoformat(),
                units_note,
                latest_note,
            )
        except Exception:
            log.exception("Sync failed for %r", material.get("name"))

    return total