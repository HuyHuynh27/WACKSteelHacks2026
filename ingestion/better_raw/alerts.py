"""Detect price moves and write the notification copy.

Two Nemotron calls per alert:

  1. a web-search pass that finds out what actually moved the market, and
  2. a structured pass that turns those notes into a push-sized headline, body
     and driver list.

Splitting them keeps the research call free to drive the search tool while the
formatting call is schema-constrained.

Unlike Anthropic's hosted web-search server tool, Nemotron only provides the
tool-calling mechanics -- the search backend is ours, so `research()` runs the
tool loop by hand against DuckDuckGo (no API key, no card).

Reasoning is on for research (it has to weigh sources) and off for formatting
(it only has to fill in a schema, and thinking tokens count against the same
output budget as the JSON).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date, timedelta

from ddgs import DDGS
from pydantic import BaseModel, Field

from . import db
from .config import settings
from .llm import NO_REASONING, REASONING, client, model

log = logging.getLogger(__name__)

# Don't re-raise an alert for the same material and window within this many days.
COOLDOWN_DAYS = 5
# Headroom for a push notification body across platforms.
MAX_BODY_CHARS = 180
# Ceiling on research round-trips, so a chatty model can't loop forever.
MAX_SEARCH_TURNS = 4
# Results pulled per search, and how much of each snippet we feed back.
SEARCH_RESULTS = 5
SNIPPET_CHARS = 300
# Reasoning eats into the same budget as the answer, so research needs room.
RESEARCH_MAX_TOKENS = 8000
COPY_MAX_TOKENS = 4096

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for recent news and return top results.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query."}
            },
            "required": ["query"],
        },
    },
}

# Hand-written and fully inlined. Pydantic's model_json_schema() emits $defs
# and $ref for the nested Driver model, which guided decoding chokes on; a flat
# schema is what the endpoint can actually enforce.
ALERT_COPY_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {
            "type": "string",
            "description": "Under 60 characters, e.g. 'Aluminum +6.2% this week'.",
        },
        "body": {
            "type": "string",
            "description": "One or two sentences, under 180 characters.",
        },
        "drivers": {
            "type": "array",
            "minItems": 1,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "driver": {
                        "type": "string",
                        "description": "Short label, e.g. 'Smelter outages'.",
                    },
                    "detail": {
                        "type": "string",
                        "description": "One concrete clause explaining it.",
                    },
                    "source": {
                        "type": ["string", "null"],
                        "description": "Source URL, or null.",
                    },
                },
                "required": ["driver", "detail", "source"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["headline", "body", "drivers"],
    "additionalProperties": False,
}

RESEARCH_SYSTEM = """\
You are a commodities analyst briefing a small manufacturer's purchasing team.

Given a price move in a raw material, use web search to find out what actually \
caused it. Look for supply disruptions, smelter or refinery outages, energy and \
freight costs, tariffs and export controls, weather, strikes, demand shifts, and \
inventory or exchange-stock changes.

Search at most three times, then write up what you found. Report only what you \
can support from the results. If they do not explain the move, say so plainly \
rather than offering a generic macro explanation. Be concrete: name places, \
companies, policies and numbers. Keep it under 200 words.
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
- drivers: one to four specific causes. Each needs a short label and a concrete \
detail. Only include a driver the research notes support. Set source to the URL \
the notes credit, or null.

If the research notes do not explain the move, say the move is unexplained in \
the body and return a single driver labelled "Cause unclear".

Output a single JSON object and nothing else.
"""


class Driver(BaseModel):
    driver: str = Field(description="Short label, e.g. 'Smelter outages'.")
    detail: str = Field(description="One concrete clause explaining it.")
    source: str | None = Field(default=None, description="Source URL, if known.")


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


def _search(query: str) -> str:
    """Run one web search and format the hits for the model."""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=SEARCH_RESULTS))
    except Exception:
        # A flaky scrape shouldn't kill the alert; the model is told to say the
        # move is unexplained when it has nothing to go on.
        log.warning("Search failed for %r", query, exc_info=True)
        return "Search failed."

    lines = [
        "- {}: {} ({})".format(
            hit.get("title", "untitled"),
            (hit.get("body") or "")[:SNIPPET_CHARS],
            hit.get("href", ""),
        )
        for hit in results
    ]
    if not lines:
        return "No results found."
    log.debug("Got %d result(s) for %r", len(lines), query)
    return "\n".join(lines)


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

    messages: list[dict] = [
        {"role": "system", "content": RESEARCH_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    for turn in range(MAX_SEARCH_TURNS):
        # On the last turn, drop the tool so the model has to write up.
        use_tools = turn < MAX_SEARCH_TURNS - 1
        response = client().chat.completions.create(
            model=model(),
            max_tokens=RESEARCH_MAX_TOKENS,
            messages=messages,
            extra_body=REASONING,
            **(
                {"tools": [WEB_SEARCH_TOOL], "tool_choice": "auto"}
                if use_tools
                else {}
            ),
        )
        msg = response.choices[0].message

        # No tool call means the model is done searching and has written up.
        if not getattr(msg, "tool_calls", None):
            return _visible_text(msg)

        messages.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [tc.model_dump() for tc in msg.tool_calls],
            }
        )
        for tool_call in msg.tool_calls:
            try:
                args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            query = args.get("query") or material["name"]
            log.debug("Searching: %r", query)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": _search(query),
                }
            )

    return ""


def _visible_text(msg) -> str:
    """The answer, minus any reasoning the endpoint leaked into content."""
    text = (msg.content or "").strip()
    # Some NIM deployments return thinking separately; others inline it.
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    return text


def write_copy(move: Move, notes: str) -> AlertCopy:
    """Turn research notes into a schema-valid headline, body and drivers."""
    material = move.material
    prompt = (
        f"Material: {material['name']}\n"
        f"Move: {move.pct_change:+.1f}% over {move.window_days} days "
        f"({move.price_before:.4f} -> {move.price_after:.4f} per {material['unit']})\n\n"
        f"Research notes:\n{notes or '(no research available)'}\n\n"
        "Respond with ONLY a JSON object matching this schema. No prose, no "
        f"markdown fences.\n{json.dumps(ALERT_COPY_SCHEMA)}"
    )

    messages: list[dict] = [
        {"role": "system", "content": COPY_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    # Reasoning off: this is a formatting job, and thinking tokens would eat the
    # same budget the JSON needs.
    kwargs: dict = {
        "model": model(),
        "max_tokens": COPY_MAX_TOKENS,
        "messages": messages,
        "extra_body": NO_REASONING,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "alert_copy",
                "schema": ALERT_COPY_SCHEMA,
                "strict": True,
            },
        },
    }

    try:
        response = client().chat.completions.create(**kwargs)
    except Exception:
        log.warning("response_format rejected; retrying without it", exc_info=True)
        kwargs.pop("response_format")
        response = client().chat.completions.create(**kwargs)

    choice = response.choices[0]
    content = _visible_text(choice.message)
    copy = _parse_copy(content)
    if copy is not None:
        return copy

    log.warning(
        "Invalid copy JSON for %r (finish_reason=%s); asking for a repair",
        material["name"],
        choice.finish_reason,
    )
    log.debug("Raw copy response was: %r", content[:2000])

    repair = client().chat.completions.create(
        model=model(),
        max_tokens=COPY_MAX_TOKENS,
        messages=messages
        + [
            {"role": "assistant", "content": content},
            {
                "role": "user",
                "content": (
                    "That was not valid JSON for the schema. Return ONLY the "
                    "corrected JSON object, starting with { and ending with }."
                ),
            },
        ],
        extra_body=NO_REASONING,
    )
    repaired = _visible_text(repair.choices[0].message)
    copy = _parse_copy(repaired)
    if copy is None:
        log.debug("Raw repair response was: %r", repaired[:2000])
        raise RuntimeError(f"No structured copy returned for {material['name']!r}")
    return copy


def _parse_copy(raw: str) -> AlertCopy | None:
    """Validate a model response, tolerating fences and stray prose."""
    text = (raw or "").strip()
    if not text:
        return None

    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text[3:]
        text = text.removeprefix("json").strip()

    # Reasoning models sometimes narrate before the object.
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]

    try:
        return AlertCopy.model_validate_json(text)
    except Exception:
        return None


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
                log.debug("Research notes (%d chars): %s", len(notes), notes[:1000])
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