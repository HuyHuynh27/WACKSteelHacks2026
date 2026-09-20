#!/usr/bin/env python3
"""Snapshot the demo data, or put it back.

Ingestion depends on Nemotron, FRED and a web scraper, none of which are
guaranteed to behave at demo time. This dumps a known-good run to JSON so the
database can be restored in a couple of seconds without calling anything.

    python demo_data.py dump      # write demo_data.json
    python demo_data.py restore   # replace live rows with the snapshot

Run from the ingestion/ directory.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from better_raw import db
from better_raw.config import ConfigError

SNAPSHOT = Path(__file__).parent / "demo_data.json"

# Order matters on restore: materials before the rows that reference them.
TABLES = ("materials", "price_points", "alerts")

# PostgREST caps a response at 1000 rows by default and says nothing about it,
# so reads are paged and writes are chunked.
PAGE = 1000

log = logging.getLogger("demo_data")


def _fetch_all(table: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        response = (
            db.client()
            .table(table)
            .select("*")
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        page = response.data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def dump() -> int:
    payload: dict[str, list[dict]] = {}
    for table in TABLES:
        rows = _fetch_all(table)
        payload[table] = rows
        log.info("%s: %d row(s)", table, len(rows))

    # An empty dump is almost always a problem elsewhere — a key that can't see
    # past RLS, or a wiped database. Writing it would leave a snapshot whose
    # only effect on restore is to delete everything.
    if not payload.get("materials"):
        raise ConfigError(
            "No materials visible, so there is nothing worth snapshotting. "
            "Check that SUPABASE_SERVICE_ROLE_KEY is the secret key (RLS is "
            "bypassed only by that one), and that the tables are populated. "
            f"Leaving {SNAPSHOT.name} untouched."
        )

    SNAPSHOT.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    log.info("Wrote %s", SNAPSHOT)
    return sum(len(rows) for rows in payload.values())


def restore() -> int:
    if not SNAPSHOT.exists():
        raise ConfigError(f"No snapshot at {SNAPSHOT}. Run `dump` first.")

    payload = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    # Restore clears before it writes, so an empty snapshot is a wipe.
    if not payload.get("materials"):
        raise ConfigError(
            f"{SNAPSHOT.name} has no materials in it. Restoring would clear the "
            "live tables and put nothing back. Delete the snapshot and dump again."
        )

    written = 0

    # Clear children first so nothing is left pointing at a removed parent.
    for table in reversed(TABLES):
        db.client().table(table).delete().neq(
            "id", "00000000-0000-0000-0000-000000000000"
        ).execute()
        log.info("%s: cleared", table)

    for table in TABLES:
        rows = payload.get(table) or []
        if not rows:
            continue
        for start in range(0, len(rows), PAGE):
            chunk = rows[start : start + PAGE]
            db.client().table(table).upsert(chunk).execute()
        written += len(rows)
        log.info("%s: restored %d row(s)", table, len(rows))

    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("dump", "restore"))
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        count = dump() if args.action == "dump" else restore()
    except ConfigError as error:
        log.error("%s", error)
        return 2
    except Exception:
        log.exception("%s failed", args.action)
        return 1

    log.info("%s: %d row(s)", args.action, count)
    return 0


if __name__ == "__main__":
    sys.exit(main())