"""Better RAW ingestion worker.

Four independent steps, each safe to run on its own:

    map       unmapped materials -> a FRED series (Claude)
    sync      FRED observations  -> price_points
    alerts    price moves        -> alerts rows with Claude-written copy
    dispatch  pending alerts     -> the app's web-push fan-out route
"""

__all__ = ["alerts", "config", "db", "dispatch", "fred", "mapper", "sync"]
