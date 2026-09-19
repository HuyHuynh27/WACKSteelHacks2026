"""Ask the app to fan out pending alerts over web-push.

The VAPID private key lives only in the Next.js deployment, so the worker posts
to /api/push/dispatch with the shared cron secret rather than signing pushes
itself.
"""

from __future__ import annotations

import logging

import httpx

from .config import settings

log = logging.getLogger(__name__)


def run() -> dict:
    config = settings()
    if not config.cron_secret:
        log.error("CRON_SECRET is not set; the dispatch route will reject this.")
        return {"error": "missing CRON_SECRET"}

    url = f"{config.app_base_url}/api/push/dispatch"
    response = httpx.post(
        url,
        headers={"x-cron-secret": config.cron_secret},
        timeout=60.0,
    )

    if response.status_code != 200:
        log.error("Dispatch failed: %s %s", response.status_code, response.text)
        response.raise_for_status()

    payload = response.json()
    log.info(
        "Dispatched: %s delivered, %s skipped",
        payload.get("delivered"),
        payload.get("skipped"),
    )
    return payload
