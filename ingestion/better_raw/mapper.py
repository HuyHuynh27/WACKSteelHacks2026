"""Map a business's own material names onto FRED price series.

A shop types "6061 aluminium extrusion"; the tracked series is `PALUMUSDM`
("Global price of Aluminum"). That judgement call is what the model is for. It
picks from the `fred_series` catalog, and may fall back to FRED's search API
when nothing in the catalog fits.

This is the classification stage of the pipeline: a below-threshold confidence
leaves the material unmapped rather than tracked against the wrong index.

Once a series is chosen, the unit conversion is resolved deterministically from
a lookup table (see units.py) — the model picks the series, it does not supply
the arithmetic.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel, Field

from . import db, fred, units
from .llm import REASONING, client, model

log = logging.getLogger(__name__)

# Below this we leave the material unmapped rather than track the wrong index.
MIN_CONFIDENCE = 0.45

SYSTEM = """\
You map the raw-material names that manufacturing businesses type into their \
purchasing system onto public price series published on FRED (Federal Reserve \
Economic Data).

Rules:
- Prefer a series that tracks the actual commodity over a broad producer price \
index, but a PPI is a good answer when no commodity series exists.
- A grade or alloy qualifier ("6061", "304 stainless", "HDPE") narrows the \
commodity but rarely has its own series — map to the underlying commodity.
- Packaging, freight and energy inputs are legitimate materials; map them to \
the relevant fuel, power or paper series.
- Confidence is your honest probability that a purchasing manager would agree \
this series tracks what they buy. Use below 0.45 when you are guessing.
- Ignore units entirely. A series quoted per metric ton is fine for a shop that \
buys by the pound; the conversion is handled elsewhere.
- If nothing in the catalog is a reasonable proxy, set series_id to null and \
say what you would search FRED for instead.
"""

REPAIR_PROMPT = (
    "That was not valid JSON for the schema. Return ONLY the corrected JSON "
    "object."
)

# Inlined rather than taken from model_json_schema(): guided decoding can't
# follow the $defs/$ref that Pydantic emits for nested models, and a flat
# schema is what the endpoint can actually enforce.
MAPPING_SCHEMA = {
    "type": "object",
    "properties": {
        "series_id": {
            "type": ["string", "null"],
            "description": "A series_id from the catalog, or null if none fits.",
        },
        "confidence": {
            "type": "number",
            "minimum": 0.0,
            "maximum": 1.0,
        },
        "reasoning": {
            "type": "string",
            "description": "One sentence on why this series fits.",
        },
        "search_query": {
            "type": ["string", "null"],
            "description": "If series_id is null, the FRED search phrase to try.",
        },
    },
    "required": ["series_id", "confidence", "reasoning", "search_query"],
    "additionalProperties": False,
}


class Mapping(BaseModel):
    series_id: str | None = Field(
        description="A series_id from the catalog, or null if none fits."
    )
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(description="One sentence on why this series fits.")
    search_query: str | None = Field(
        default=None,
        description="If series_id is null, the FRED search phrase to try instead.",
    )


def _catalog_prompt(catalog: Iterable[dict[str, Any]]) -> str:
    lines = []
    for row in catalog:
        line = "- {}: {}".format(row["series_id"], row["title"])
        if row.get("units"):
            line += " ({})".format(row["units"])
        if row.get("keywords"):
            line += " [{}]".format(", ".join(row["keywords"]))
        lines.append(line)
    return "\n".join(lines)


def _material_prompt(material: dict[str, Any]) -> str:
    parts = [f"Material name: {material['name']}"]
    if material.get("category"):
        parts.append(f"Category: {material['category']}")
    if material.get("unit"):
        parts.append(f"Purchased by the: {material['unit']}")
    if material.get("notes"):
        parts.append(f"Buyer's notes: {material['notes']}")
    return "\n".join(parts)


def _parse_mapping(raw: str) -> Mapping | None:
    """Validate a model response, tolerating fences and pre-object narration."""
    text = (raw or "").strip()
    if not text:
        return None

    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text[3:]
        text = text.removeprefix("json").strip()

    # Reasoning models sometimes explain themselves before the object.
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]

    try:
        return Mapping.model_validate_json(text)
    except Exception:
        return None


def map_material(material: dict[str, Any], catalog: list[dict[str, Any]]) -> Mapping:
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": (
                f"Catalog of available FRED series:\n{_catalog_prompt(catalog)}\n\n"
                f"Map this material:\n{_material_prompt(material)}\n\n"
                "Respond with ONLY a JSON object matching this schema. No prose, "
                f"no markdown fences.\n{json.dumps(MAPPING_SCHEMA)}"
            ),
        },
    ]

    # response_format is best-effort: some Nemotron endpoints ignore or reject
    # it, so the parse below is what actually guarantees the shape.
    kwargs: dict[str, Any] = {
        "model": model(),
        "max_tokens": 4096,
        "messages": messages,
        "extra_body": REASONING,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "mapping",
                "schema": MAPPING_SCHEMA,
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
    content = choice.message.content or ""
    mapping = _parse_mapping(content)
    if mapping is not None:
        return mapping

    log.warning(
        "Invalid mapping JSON for %r (finish_reason=%s); asking for a repair",
        material["name"],
        choice.finish_reason,
    )
    log.debug("Raw mapping response was: %r", content[:2000])

    repair = client().chat.completions.create(
        model=model(),
        max_tokens=4096,
        messages=messages
        + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": REPAIR_PROMPT},
        ],
        extra_body=REASONING,
    )

    repaired = repair.choices[0].message.content or ""
    mapping = _parse_mapping(repaired)
    if mapping is None:
        log.debug("Raw repair response was: %r", repaired[:2000])
        raise RuntimeError(f"No structured mapping returned for {material['name']!r}")
    return mapping


def _adopt_searched_series(query: str) -> fred.SeriesInfo | None:
    """Pull the most popular matching series into the catalog so it can be used."""
    for info in fred.search_series(query, limit=5):
        # Daily/weekly/monthly series are usable; annual ones are not.
        if info.frequency and info.frequency.lower().startswith("annual"):
            continue
        db.upsert_fred_series(
            [
                {
                    "series_id": info.series_id,
                    "title": info.title,
                    "units": info.units,
                    "frequency": info.frequency,
                    "keywords": [word.lower() for word in query.split()],
                }
            ]
        )
        return info
    return None


def run(limit: int = 50) -> int:
    """Map every unmapped material. Returns how many were mapped."""
    materials = db.fetch_unmapped_materials(limit=limit)
    if not materials:
        log.info("No unmapped materials.")
        return 0

    catalog = db.fetch_fred_catalog()
    if not catalog:
        log.error("fred_series catalog is empty — run the seed migration first.")
        return 0

    catalog_by_id = {row["series_id"]: row for row in catalog}
    mapped = 0

    for material in materials:
        try:
            mapping = map_material(material, catalog)
        except Exception:
            log.exception("Mapping failed for %r", material["name"])
            continue

        series_id = mapping.series_id
        confidence = mapping.confidence
        series_units: str | None = None

        if series_id is None and mapping.search_query:
            log.info(
                "%r not in catalog; searching FRED for %r",
                material["name"],
                mapping.search_query,
            )
            found = _adopt_searched_series(mapping.search_query)
            if found:
                series_id = found.series_id
                series_units = found.units
                # A search hit is a weaker signal than a catalog match.
                confidence = min(confidence, 0.5)
                catalog = db.fetch_fred_catalog()
                catalog_by_id = {row["series_id"]: row for row in catalog}

        if series_id is None or confidence < MIN_CONFIDENCE:
            log.warning(
                "Leaving %r unmapped (series=%s, confidence=%.2f): %s",
                material["name"],
                series_id,
                confidence,
                mapping.reasoning,
            )
            continue

        if series_units is None:
            catalog_row = catalog_by_id.get(series_id) or {}
            series_units = catalog_row.get("units")

        price_units = units.resolve(series_units, material.get("unit"))

        if price_units.is_index:
            log.warning(
                "%r maps to an index series (%s); prices are relative and are "
                "excluded from cost rollups.",
                material["name"],
                series_id,
            )
        elif not price_units.converted:
            log.warning(
                "%r: no unit conversion from %r to %r; prices stored as quoted.",
                material["name"],
                price_units.native_unit,
                material.get("unit"),
            )

        db.set_material_series(
            material["id"],
            series_id,
            confidence,
            price_factor=price_units.factor,
            price_native_unit=price_units.native_unit,
            price_is_index=price_units.is_index,
        )
        mapped += 1
        log.info(
            "%r -> %s (%.2f) [%s -> %s, x%.6g]: %s",
            material["name"],
            series_id,
            confidence,
            price_units.native_unit,
            material.get("unit") or "?",
            price_units.factor,
            mapping.reasoning,
        )

    return mapped