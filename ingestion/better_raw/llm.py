"""Shared NVIDIA (Nemotron) client, OpenAI-compatible.

Swapped from Anthropic to NVIDIA's build.nvidia.com endpoint for the Nemotron
hackathon track. Structured output and tool calling follow the OpenAI Chat
Completions contract; reasoning depth is set via extra_body rather than a
`thinking` param, and there's no hosted web-search tool — the search backend is
wired up separately in alerts.py against DuckDuckGo.
"""

from __future__ import annotations

from functools import lru_cache

import openai

from .config import settings

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"


@lru_cache(maxsize=1)
def client() -> openai.OpenAI:
    return openai.OpenAI(api_key=settings().nvidia_api_key, base_url=NVIDIA_BASE_URL)


def model() -> str:
    return settings().nvidia_model  # e.g. "nvidia/nemotron-3-super-120b-a12b"


# Nemotron's reasoning-depth knob — the analogue of Anthropic's `thinking`.
# Use it where the model has a judgement to make.
REASONING = {
    "chat_template_kwargs": {"enable_thinking": True},
    "reasoning_budget": 8192,
}

# Reasoning tokens come out of the same output budget as the answer, so turn it
# off for jobs that are pure formatting.
NO_REASONING = {
    "chat_template_kwargs": {"enable_thinking": False},
}