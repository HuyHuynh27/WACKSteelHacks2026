"""Shared Anthropic client.

Adaptive thinking is on for every call — the mapping and copywriting jobs both
benefit and the API decides how much to spend.
"""

from __future__ import annotations

from functools import lru_cache

import anthropic

from .config import settings


@lru_cache(maxsize=1)
def client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings().anthropic_api_key)


def model() -> str:
    return settings().anthropic_model


THINKING = {"type": "adaptive"}
