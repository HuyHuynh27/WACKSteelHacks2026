"""Environment-backed settings, loaded once."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

# Local runs read ../.env.local (the same file Next.js uses); in CI the values
# come from repository secrets, and load_dotenv is a no-op.
for candidate in (".env.local", ".env", "../.env.local", "../.env"):
    load_dotenv(candidate, override=False)


class ConfigError(RuntimeError):
    pass


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(
            f"Missing environment variable {name}. "
            "See .env.example for the full list."
        )
    return value


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    fred_api_key: str
    anthropic_api_key: str
    anthropic_model: str
    app_base_url: str
    cron_secret: str

    # How far back to backfill a newly mapped series.
    backfill_days: int = 365 * 6
    # Windows the alert detector evaluates, longest first.
    alert_windows: tuple[int, ...] = (7, 30)


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings(
        supabase_url=_require("NEXT_PUBLIC_SUPABASE_URL"),
        supabase_service_key=_require("SUPABASE_SERVICE_ROLE_KEY"),
        fred_api_key=_require("FRED_API_KEY"),
        anthropic_api_key=_require("ANTHROPIC_API_KEY"),
        anthropic_model=os.environ.get("ANTHROPIC_MODEL", "claude-opus-5"),
        app_base_url=os.environ.get("APP_BASE_URL", "http://localhost:3000").rstrip("/"),
        cron_secret=os.environ.get("CRON_SECRET", ""),
    )
