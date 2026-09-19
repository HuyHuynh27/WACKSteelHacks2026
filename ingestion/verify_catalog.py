#!/usr/bin/env python3
"""Check every fred_series row against the real FRED API.

A wrong series id is silent: the material maps, the sync finds nothing, and the
chart is just empty. This reports mismatches so the seed migration can be fixed.

    python verify_catalog.py            # report only
    python verify_catalog.py --fix      # also correct titles/units in the DB
                                        # and drop rows FRED does not know
"""

from __future__ import annotations

import argparse
import logging
import sys

from better_raw import db, fred
from better_raw.config import ConfigError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Correct titles/units and delete unknown series.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    log = logging.getLogger("verify")

    catalog = db.fetch_fred_catalog()
    if not catalog:
        log.error("fred_series is empty — run the migrations first.")
        return 2

    missing: list[str] = []
    corrections: list[dict] = []
    ok = 0

    for row in sorted(catalog, key=lambda r: r["series_id"]):
        series_id = row["series_id"]
        try:
            info = fred.get_series(series_id)
        except Exception as error:  # noqa: BLE001 - one bad lookup must not abort the audit
            log.warning("?    %-14s lookup failed: %s", series_id, error)
            continue

        if info is None:
            log.error("GONE %-14s FRED does not know this id", series_id)
            missing.append(series_id)
            continue

        drifted = info.title != row["title"] or info.units != row.get("units")
        if drifted:
            log.warning(
                "DIFF %-14s\n       stored: %s (%s)\n       fred:   %s (%s)",
                series_id,
                row["title"],
                row.get("units"),
                info.title,
                info.units,
            )
            corrections.append(
                {
                    "series_id": series_id,
                    "title": info.title,
                    "units": info.units,
                    "frequency": info.frequency,
                    "keywords": row.get("keywords") or [],
                }
            )
        else:
            ok += 1

    log.info(
        "\n%d verified, %d with drifted metadata, %d unknown to FRED",
        ok,
        len(corrections),
        len(missing),
    )

    if not args.fix:
        if missing or corrections:
            log.info("Re-run with --fix to correct the catalog in place.")
        return 1 if missing else 0

    if corrections:
        db.upsert_fred_series(corrections)
        log.info("Corrected %d row(s).", len(corrections))

    for series_id in missing:
        # Materials pointing at it fall back to null via ON DELETE SET NULL and
        # get re-mapped on the next `run.py map`.
        db.client().table("fred_series").delete().eq("series_id", series_id).execute()
    if missing:
        log.info("Deleted %d unknown row(s): %s", len(missing), ", ".join(missing))

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ConfigError as error:
        print(error, file=sys.stderr)
        sys.exit(2)
