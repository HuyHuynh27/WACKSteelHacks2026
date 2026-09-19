"""Map a business's own material names onto FRED price series.

A shop types "6061 aluminium extrusion"; the tracked series is `PALUMUSDM`
("Global price of Aluminum"). That judgement call is what Claude is for. The
model picks from the `fred_series` catalog, and may fall back to FRED's search
API when nothing in the catalog fits.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel, Field

from . import db, fred
from .llm import THINKING, client, model

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
- If nothing in the catalog is a reasonable proxy, set series_id to null and \
say what you would search FRED for instead.
"""


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


def map_material(material: dict[str, Any], catalog: list[dict[str, Any]]) -> Mapping:
    response = client().messages.parse(
        model=model(),
        max_tokens=4096,
        thinking=THINKING,
        system=SYSTEM,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Catalog of available FRED series:\n{_catalog_prompt(catalog)}\n\n"
                    f"Map this material:\n{_material_prompt(material)}"
                ),
            }
        ],
        output_format=Mapping,
    )

    mapping = response.parsed_output
    if mapping is None:
        # Only happens if the model returns no text block at all.
        raise RuntimeError(
            f"No structured mapping returned for {material['name']!r} "
            f"(stop_reason={response.stop_reason})"
        )
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

    mapped = 0
    for material in materials:
        try:
            mapping = map_material(material, catalog)
        except Exception:
            log.exception("Mapping failed for %r", material["name"])
            continue

        series_id = mapping.series_id
        confidence = mapping.confidence

        if series_id is None and mapping.search_query:
            log.info(
                "%r not in catalog; searching FRED for %r",
                material["name"],
                mapping.search_query,
            )
            found = _adopt_searched_series(mapping.search_query)
            if found:
                series_id = found.series_id
                # A search hit is a weaker signal than a catalog match.
                confidence = min(confidence, 0.5)
                catalog = db.fetch_fred_catalog()

        if series_id is None or confidence < MIN_CONFIDENCE:
            log.warning(
                "Leaving %r unmapped (series=%s, confidence=%.2f): %s",
                material["name"],
                series_id,
                confidence,
                mapping.reasoning,
            )
            continue

        db.set_material_series(material["id"], series_id, confidence)
        mapped += 1
        log.info(
            "%r -> %s (%.2f): %s",
            material["name"],
            series_id,
            confidence,
            mapping.reasoning,
        )

    return mapped
