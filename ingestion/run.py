#!/usr/bin/env python3
"""Better RAW ingestion CLI.

    python run.py all          # map -> sync -> alerts -> dispatch
    python run.py map
    python run.py sync
    python run.py alerts
    python run.py dispatch

Run from the ingestion/ directory (or anywhere, with the env vars set).
"""

from __future__ import annotations

import argparse
import logging
import sys

from better_raw import alerts, dispatch, mapper, sync
from better_raw.config import ConfigError

STEPS = {
    "map": lambda: f"mapped {mapper.run()} material(s)",
    "sync": lambda: f"wrote {sync.run()} price point(s)",
    "alerts": lambda: f"raised {alerts.run()} alert(s)",
    "dispatch": lambda: f"dispatch: {dispatch.run()}",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=[*STEPS, "all"])
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Show debug logging."
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )
    # httpx logs every request at INFO, which drowns out our own output.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    log = logging.getLogger("better_raw")

    names = list(STEPS) if args.step == "all" else [args.step]
    failed = False

    for name in names:
        log.info("--- %s ---", name)
        try:
            log.info("%s", STEPS[name]())
        except ConfigError as error:
            log.error("%s", error)
            return 2
        except Exception:
            log.exception("Step %r failed", name)
            failed = True
            # Keep going: a failed alert pass shouldn't block dispatch of
            # alerts raised on an earlier run.

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
