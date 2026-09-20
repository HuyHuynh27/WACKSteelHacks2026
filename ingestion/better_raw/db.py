"""Supabase access for the worker.

The worker authenticates with the service-role key, so it bypasses RLS and can
see every business's materials. Keep that key out of anything user-facing.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from .config import settings


@lru_cache(maxsize=1)
def client() -> Client:
    config = settings()
    return create_client(config.supabase_url, config.supabase_service_key)


def fetch_fred_catalog() -> list[dict[str, Any]]:
    """Candidate series the mapper chooses from."""
    response = client().table("fred_series").select("*").execute()
    return response.data or []


def fetch_unmapped_materials(limit: int = 50) -> list[dict[str, Any]]:
    response = (
        client()
        .table("materials")
        .select("id, user_id, name, category, unit, notes")
        .is_("fred_series_id", "null")
        .eq("tracking", True)
        .limit(limit)
        .execute()
    )
    return response.data or []


def set_material_series(
    material_id: str,
    series_id: str | None,
    confidence: float | None,
    price_factor: float = 1.0,
    price_native_unit: str | None = None,
    price_is_index: bool = False,
) -> None:
    """Record the mapping plus how to get from the series' unit to the shop's."""
    client().table("materials").update(
        {
            "fred_series_id": series_id,
            "fred_confidence": confidence,
            "fred_mapped_at": datetime.now(timezone.utc).isoformat(),
            "price_factor": price_factor,
            "price_native_unit": price_native_unit,
            "price_is_index": price_is_index,
        }
    ).eq("id", material_id).execute()


def upsert_fred_series(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    client().table("fred_series").upsert(rows, on_conflict="series_id").execute()


def fetch_tracked_materials() -> list[dict[str, Any]]:
    """Materials that have a series and are still being watched."""
    response = (
        client()
        .table("materials")
        .select(
            "id, user_id, name, unit, currency, fred_series_id, "
            "alert_threshold_pct, price_factor, price_native_unit, price_is_index"
        )
        .not_.is_("fred_series_id", "null")
        .eq("tracking", True)
        .execute()
    )
    return response.data or []


def latest_observation_date(material_id: str) -> str | None:
    response = (
        client()
        .table("price_points")
        .select("observed_on")
        .eq("material_id", material_id)
        .eq("source", "fred")
        .order("observed_on", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0]["observed_on"] if rows else None


def upsert_price_points(rows: list[dict[str, Any]]) -> int:
    """Idempotent on (material_id, observed_on, source)."""
    if not rows:
        return 0
    client().table("price_points").upsert(
        rows, on_conflict="material_id,observed_on,source"
    ).execute()
    return len(rows)


def fetch_price_history(material_id: str, limit: int = 120) -> list[dict[str, Any]]:
    """Newest first — the detector only looks at the recent tail."""
    response = (
        client()
        .table("price_points")
        .select("observed_on, price")
        .eq("material_id", material_id)
        .order("observed_on", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data or []


def recent_alert_exists(material_id: str, window_days: int, within_days: int) -> bool:
    """Guards against re-alerting on the same move every run."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=within_days)).isoformat()
    response = (
        client()
        .table("alerts")
        .select("id", count="exact")
        .eq("material_id", material_id)
        .eq("window_days", window_days)
        .gte("created_at", cutoff)
        .limit(1)
        .execute()
    )
    return bool(response.count)


def insert_alert(row: dict[str, Any]) -> dict[str, Any] | None:
    response = client().table("alerts").insert(row).execute()
    rows = response.data or []
    return rows[0] if rows else None


def notification_prefs(user_id: str) -> dict[str, Any] | None:
    response = (
        client()
        .table("notification_prefs")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None