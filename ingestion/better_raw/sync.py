"""Pull FRED observations into price_points.

Incremental: each material resumes from its newest stored observation, so a
daily run fetches a handful of rows. A newly mapped material backfills
`backfill_days` of history in one go.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from . import db, fred
from .config import settings

log = logging.getLogger(__name__)


def _start_date(material_id: str) -> date:
    latest = db.latest_observation_date(material_id)
    if latest:
        # Re-fetch the last stored day too; FRED revises recent values.
        return date.fromisoformat(latest)
    # The job runs on a UTC schedule, so anchor the backfill window to UTC.
    today = datetime.now(timezone.utc).date()
    return today - timedelta(days=settings().backfill_days)


def _rows_for(material: dict, observations: list[fred.Observation]) -> list[dict]:
    return [
        {
            "material_id": material["id"],
            "observed_on": observation.observed_on.isoformat(),
            "price": observation.value,
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

            written = db.upsert_price_points(_rows_for(material, observations))
            total += written
            log.info(
                "%s (%s): %d observations from %s",
                material["name"],
                series_id,
                written,
                start.isoformat(),
            )
        except Exception:
            log.exception("Sync failed for %r", material.get("name"))

    return total
