"""Detect price moves and write the notification copy.

Two Claude calls per alert:

  1. a web-search pass that finds out what actually moved the market, and
  2. a structured pass that turns those notes into a push-sized headline, body
     and driver list.

Splitting them keeps the research call free to use the web-search server tool
while the formatting call is schema-constrained.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta

from pydantic import BaseModel, Field

from . import db
from .config import settings
from .llm import THINKING, client, model

log = logging.getLogger(__name__)

# Don't re-raise an alert for the same material and window within this many days.
COOLDOWN_DAYS = 5
# Headroom for a push notification body across platforms.
MAX_BODY_CHARS = 180

RESEARCH_SYSTEM = """\
You are a commodities analyst briefing a small manufacturer's purchasing team.

Given a price move in a raw material, use web search to find out what actually \
caused it. Look for supply disruptions, smelter or refinery outages, energy and \
freight costs, tariffs and export controls, weather, strikes, demand shifts, and \
inventory or exchange-stock changes.

Report only what you can support from what you found. If the sources do not \
explain the move, say so plainly rather than offering a generic macro \
explanation. Be concrete: name places, companies, policies and numbers. Keep it \
under 200 words.
"""

COPY_SYSTEM = """\
You write push notifications for a raw-material price tracker used by small \
manufacturers.

The reader is a purchasing manager glancing at a phone. Write plainly, no \
marketing voice, no exclamation marks, no emoji.

- headline: under 60 characters, leading with the material and the signed move, \
e.g. "Aluminum +6.2% this week".
- body: one or two sentences under 180 characters naming the drivers and what it \
means for their costs.
- drivers: two to four specific causes. Each needs a short label and a concrete \
detail. Only include a driver the research notes support.

If the research notes do not explain the move, say the move is unexplained in \
the body and return a single driver labelled "Cause unclear".
"""


class Driver(BaseModel):
    driver: str = Field(description="Short label, e.g. 'Smelter outages'.")
    detail: str = Field(description="One concrete clause explaining it.")
    source: str | None = Field(
        default=None, description="Publication or site name, if known."
    )


class AlertCopy(BaseModel):
    headline: str = Field(max_length=90)
    body: str = Field(max_length=300)
    drivers: list[Driver]


@dataclass(frozen=True)
class Move:
    material: dict
    window_days: int
    price_before: float
    price_after: float
    observed_on: str

    @property
    def pct_change(self) -> float:
        return ((self.price_after - self.price_before) / self.price_before) * 100

    @property
    def kind(self) -> str:
        return "spike" if self.pct_change > 0 else "dip"


def detect_move(material: dict, window_days: int) -> Move | None:
    """Compare the newest observation against the one ~window_days earlier."""
    history = db.fetch_price_history(material["id"], limit=200)
    if len(history) < 2:
        return None

    newest = history[0]
    target = date.fromisoformat(newest["observed_on"]) - timedelta(days=window_days)

    # history is newest-first, so the first row at or before the target date is
    # the closest earlier observation.
    earlier = next(
        (row for row in history if date.fromisoformat(row["observed_on"]) <= target),
        None,
    )
    if earlier is None:
        return None

    before = float(earlier["price"])
    if before == 0:
        return None

    return Move(
        material=material,
        window_days=window_days,
        price_before=before,
        price_after=float(newest["price"]),
        observed_on=newest["observed_on"],
    )


def research(move: Move) -> str:
    """Free-text notes on what drove the move, gathered with web search."""
    material = move.material
    prompt = (
        f"Raw material: {material['name']}\n"
        f"Tracked series: {material['fred_series_id']}\n"
        f"Move: {move.pct_change:+.1f}% over {move.window_days} days, "
        f"{move.price_before:.4f} -> {move.price_after:.4f} per {material['unit']}\n"
        f"Latest observation: {move.observed_on}\n\n"
        "What caused this? Search for recent news."
    )

    response = client().messages.create(
        model=model(),
        max_tokens=8000,
        thinking=THINKING,
        system=RESEARCH_SYSTEM,
        tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 6}],
        messages=[{"role": "user", "content": prompt}],
    )

    return "\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()


def write_copy(move: Move, notes: str) -> AlertCopy:
    material = move.material
    prompt = (
        f"Material: {material['name']}\n"
        f"Move: {move.pct_change:+.1f}% over {move.window_days} days "
        f"({move.price_before:.4f} -> {move.price_after:.4f} per {material['unit']})\n\n"
        f"Research notes:\n{notes or '(no research available)'}"
    )

    response = client().messages.parse(
        model=model(),
        max_tokens=4096,
        thinking=THINKING,
        system=COPY_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        output_format=AlertCopy,
    )

    copy = response.parsed_output
    if copy is None:
        raise RuntimeError(
            f"No structured copy returned for {material['name']!r} "
            f"(stop_reason={response.stop_reason})"
        )
    return copy


def run() -> int:
    """Raise an alert for every tracked material that breached its threshold."""
    materials = db.fetch_tracked_materials()
    if not materials:
        log.info("No tracked materials.")
        return 0

    raised = 0
    for material in materials:
        threshold = float(material.get("alert_threshold_pct") or 5)

        # Longest window first: a 30-day drift shouldn't be reported twice when
        # the 7-day window also trips.
        for window_days in sorted(settings().alert_windows, reverse=True):
            try:
                move = detect_move(material, window_days)
            except Exception:
                log.exception("Detection failed for %r", material.get("name"))
                break

            if move is None or abs(move.pct_change) < threshold:
                continue

            if db.recent_alert_exists(material["id"], window_days, COOLDOWN_DAYS):
                log.info(
                    "%s: %+.1f%% over %dd already reported recently",
                    material["name"],
                    move.pct_change,
                    window_days,
                )
                break

            try:
                notes = research(move)
                copy = write_copy(move, notes)
            except Exception:
                log.exception("Copywriting failed for %r", material["name"])
                break

            body = copy.body.strip()
            if len(body) > MAX_BODY_CHARS:
                body = body[: MAX_BODY_CHARS - 1].rstrip() + "…"

            inserted = db.insert_alert(
                {
                    "user_id": material["user_id"],
                    "material_id": material["id"],
                    "kind": move.kind,
                    "window_days": window_days,
                    "pct_change": round(move.pct_change, 3),
                    "price_before": round(move.price_before, 4),
                    "price_after": round(move.price_after, 4),
                    "headline": copy.headline.strip(),
                    "body": body,
                    "drivers": [driver.model_dump() for driver in copy.drivers],
                }
            )

            if inserted:
                raised += 1
                log.info("Raised: %s", copy.headline)

            # One alert per material per run.
            break

    return raised
