"""Convert FRED-quoted prices into the unit a shop actually buys by.

FRED quotes aluminum in dollars per metric ton; a shop buys 6061 by the pound.
Multiplying a per-tonne price by a pound quantity is off by ~2200x, and the
error is invisible — it just shows up as a plausible-looking wrong number in
the BOM rollup. So every price is normalised at sync time, before it lands in
`price_points`.

The constants here are hard-coded on purpose. A model-generated conversion
factor that is quietly wrong would corrupt every cost figure downstream with no
symptom, so this stage is deliberately dumb and deterministic.

Percentage changes are invariant under a linear factor, so alert thresholds and
`pct_change` are unaffected by any of this.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

log = logging.getLogger(__name__)

# A series quoted as an index (PPI and friends) has no absolute price, so it
# cannot be converted and must never be multiplied into a cost.
INDEX_MARKERS = ("index", "=100", "= 100")

# Mass, in kilograms.
MASS_KG: dict[str, float] = {
    "metric ton": 1000.0,
    "metric tons": 1000.0,
    "metric tonne": 1000.0,
    "tonne": 1000.0,
    "tonnes": 1000.0,
    "mt": 1000.0,
    "short ton": 907.18474,
    "short tons": 907.18474,
    "ton": 907.18474,
    "tons": 907.18474,
    "long ton": 1016.0469088,
    "kilogram": 1.0,
    "kilograms": 1.0,
    "kilo": 1.0,
    "kg": 1.0,
    "gram": 0.001,
    "grams": 0.001,
    "g": 0.001,
    "pound": 0.45359237,
    "pounds": 0.45359237,
    "lb": 0.45359237,
    "lbs": 0.45359237,
    "hundredweight": 45.359237,
    "cwt": 45.359237,
    "ounce": 0.028349523125,
    "ounces": 0.028349523125,
    "oz": 0.028349523125,
    "troy ounce": 0.0311034768,
    "troy ounces": 0.0311034768,
}

# Volume, in litres.
VOLUME_L: dict[str, float] = {
    "barrel": 158.987294928,
    "barrels": 158.987294928,
    "bbl": 158.987294928,
    "gallon": 3.785411784,
    "gallons": 3.785411784,
    "gal": 3.785411784,
    "liter": 1.0,
    "liters": 1.0,
    "litre": 1.0,
    "litres": 1.0,
    "l": 1.0,
    "cubic meter": 1000.0,
    "cubic meters": 1000.0,
    "m3": 1000.0,
    "cubic foot": 28.316846592,
    "cubic feet": 28.316846592,
    "thousand cubic feet": 28316.846592,
    "mcf": 28316.846592,
}

# Energy, in MMBtu.
ENERGY_MMBTU: dict[str, float] = {
    "million btu": 1.0,
    "million british thermal units": 1.0,
    "mmbtu": 1.0,
    "btu": 1e-6,
    "therm": 0.1,
    "therms": 0.1,
    "kilowatt hour": 0.003412141633,
    "kilowatt hours": 0.003412141633,
    "kwh": 0.003412141633,
    "megawatt hour": 3.412141633,
    "megawatt hours": 3.412141633,
    "mwh": 3.412141633,
}

# Sawn-timber volume, in board feet.
LUMBER_BF: dict[str, float] = {
    "board foot": 1.0,
    "board feet": 1.0,
    "bf": 1.0,
    "thousand board feet": 1000.0,
    "mbf": 1000.0,
}

DIMENSIONS: tuple[dict[str, float], ...] = (
    MASS_KG,
    VOLUME_L,
    ENERGY_MMBTU,
    LUMBER_BF,
)

# Anything in this set means the quote is in cents, not dollars.
CENT_MARKERS = ("cent",)


@dataclass(frozen=True)
class PriceUnits:
    """How to get from a raw FRED observation to the shop's own unit."""

    factor: float
    """Multiply the raw observation by this."""

    native_unit: str
    """The unit the series is actually quoted in, for display."""

    is_index: bool
    """True when the series is an index and has no absolute price."""

    converted: bool
    """False when no conversion could be resolved and factor fell back to 1."""


def _normalise(text: str) -> str:
    text = text.strip().lower()
    text = text.replace("(", " ").replace(")", " ")
    text = re.sub(r"[.,;]+$", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _lookup(unit: str) -> tuple[dict[str, float], float] | None:
    """Find which dimension a unit belongs to, and its size in that dimension."""
    unit = _normalise(unit)
    for table in DIMENSIONS:
        if unit in table:
            return table, table[unit]
    # Try dropping a trailing plural 's'.
    if unit.endswith("s"):
        singular = unit[:-1]
        for table in DIMENSIONS:
            if singular in table:
                return table, table[singular]
    return None


def parse_fred_units(units: str | None) -> tuple[float, str] | None:
    """'U.S. Dollars per Metric Ton' -> (1.0, 'metric ton').

    Returns None when the string is an index or cannot be parsed. The float is
    the currency scale (0.01 for a cents quote).
    """
    if not units:
        return None

    text = _normalise(units)
    if any(marker in text for marker in INDEX_MARKERS):
        return None

    if " per " not in text:
        return None

    left, right = text.split(" per ", 1)
    scale = 0.01 if any(m in left for m in CENT_MARKERS) else 1.0
    return scale, _normalise(right)


def resolve(series_units: str | None, material_unit: str | None) -> PriceUnits:
    """Work out the factor taking a raw observation to price-per-material-unit."""
    parsed = parse_fred_units(series_units)

    if parsed is None:
        is_index = bool(series_units) and any(
            m in _normalise(series_units) for m in INDEX_MARKERS
        )
        if is_index:
            log.info("Series is an index (%r); leaving prices unscaled.", series_units)
            return PriceUnits(1.0, series_units or "index", True, False)
        log.warning("Could not parse series units %r; using factor 1.", series_units)
        return PriceUnits(1.0, series_units or "unknown", False, False)

    scale, native_unit = parsed

    if not material_unit:
        log.warning("Material has no unit; quoting in %r.", native_unit)
        return PriceUnits(scale, native_unit, False, False)

    native = _lookup(native_unit)
    target = _lookup(material_unit)

    if native is None or target is None:
        log.warning(
            "No conversion from %r to %r; quoting in %r.",
            native_unit,
            material_unit,
            native_unit,
        )
        return PriceUnits(scale, native_unit, False, False)

    native_table, native_size = native
    target_table, target_size = target

    if native_table is not target_table:
        log.warning(
            "%r and %r are different kinds of unit; quoting in %r.",
            native_unit,
            material_unit,
            native_unit,
        )
        return PriceUnits(scale, native_unit, False, False)

    # price per target = price per native * (target_size / native_size)
    factor = scale * (target_size / native_size)
    log.debug(
        "Converting %r -> %r: factor %.10g", native_unit, material_unit, factor
    )
    return PriceUnits(factor, native_unit, False, True)