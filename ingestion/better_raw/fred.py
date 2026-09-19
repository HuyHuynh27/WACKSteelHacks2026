"""Thin FRED (St. Louis Fed) API client.

Docs: https://fred.stlouisfed.org/docs/api/fred/
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

from .config import settings

log = logging.getLogger(__name__)

BASE_URL = "https://api.stlouisfed.org/fred"
# FRED marks missing observations with a literal ".".
MISSING = "."


@dataclass(frozen=True)
class Observation:
    observed_on: date
    value: float


@dataclass(frozen=True)
class SeriesInfo:
    series_id: str
    title: str
    units: str | None
    frequency: str | None


def _get(path: str, **params: Any) -> dict[str, Any]:
    config = settings()
    query = {
        "api_key": config.fred_api_key,
        "file_type": "json",
        **{k: v for k, v in params.items() if v is not None},
    }
    response = httpx.get(f"{BASE_URL}/{path}", params=query, timeout=30.0)
    response.raise_for_status()
    return response.json()


def get_observations(
    series_id: str, start: date | None = None, end: date | None = None
) -> list[Observation]:
    payload = _get(
        "series/observations",
        series_id=series_id,
        observation_start=start.isoformat() if start else None,
        observation_end=end.isoformat() if end else None,
        sort_order="asc",
    )

    observations: list[Observation] = []
    for row in payload.get("observations", []):
        raw = row.get("value")
        if raw is None or raw == MISSING:
            continue
        try:
            observations.append(
                Observation(date.fromisoformat(row["date"]), float(raw))
            )
        except (ValueError, KeyError):
            log.warning("Skipping malformed observation for %s: %r", series_id, row)

    return observations


def get_series(series_id: str) -> SeriesInfo | None:
    try:
        payload = _get("series", series_id=series_id)
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 400:
            return None
        raise

    rows = payload.get("seriess") or []
    if not rows:
        return None

    row = rows[0]
    return SeriesInfo(
        series_id=row["id"],
        title=row.get("title", row["id"]),
        units=row.get("units"),
        frequency=row.get("frequency"),
    )


def search_series(query: str, limit: int = 12) -> Iterator[SeriesInfo]:
    """Full-text search, most popular first — the mapper's fallback."""
    payload = _get(
        "series/search",
        search_text=query,
        limit=limit,
        order_by="popularity",
        sort_order="desc",
        filter_variable="frequency",
    )

    for row in payload.get("seriess", []):
        yield SeriesInfo(
            series_id=row["id"],
            title=row.get("title", row["id"]),
            units=row.get("units"),
            frequency=row.get("frequency"),
        )
