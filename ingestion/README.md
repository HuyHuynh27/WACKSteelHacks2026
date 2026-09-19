# Ingestion worker

Python, because the data pipeline has no business being in TypeScript. Runs as a
scheduled GitHub Action (`.github/workflows/ingest.yml`) — no server to host.

## The four steps

| Step       | What it does                                                        |
| ---------- | ------------------------------------------------------------------- |
| `map`      | Unmapped materials → a FRED series, via Claude + the `fred_series` catalogue |
| `sync`     | FRED observations → `price_points` (incremental, idempotent)         |
| `alerts`   | Price moves past a material's threshold → `alerts` rows with Claude-written copy |
| `dispatch` | POSTs `/api/push/dispatch` so the app fans the alerts out over web-push |

`map` and `alerts` call Claude; the rest is plain HTTP and SQL.

## Running it locally

```bash
cd ingestion
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Reads ../.env.local automatically — see .env.example at the repo root.
python run.py all

# Or one step at a time
python run.py map -v
python run.py sync
python run.py alerts
python run.py dispatch
```

Every step is safe to re-run. `sync` upserts on
`(material_id, observed_on, source)`; `alerts` has a five-day per-material
cooldown so the same move isn't reported twice.

## Verifying the series catalogue

A wrong FRED series id is silent — the material maps, the sync finds nothing,
and the chart is just empty. Every id in
`supabase/migrations/0002_seed_fred_series.sql` was checked by hand, but check
them again after editing:

```bash
python verify_catalog.py          # report drift and unknown ids
python verify_catalog.py --fix    # correct titles/units, drop unknown ids
```

## Environment

| Variable                     | Used by            |
| ---------------------------- | ------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`   | all                |
| `SUPABASE_SERVICE_ROLE_KEY`  | all (bypasses RLS) |
| `FRED_API_KEY`               | `map`, `sync`      |
| `ANTHROPIC_API_KEY`          | `map`, `alerts`    |
| `ANTHROPIC_MODEL`            | optional, defaults to `claude-opus-5` |
| `APP_BASE_URL`               | `dispatch`         |
| `CRON_SECRET`                | `dispatch`         |

In CI these come from repository secrets; `ANTHROPIC_MODEL` and `APP_BASE_URL`
are repository *variables*.

## How mapping works

A shop types "6061 aluminium extrusion". The tracked series is `PALUMUSDM`
("Global price of Aluminum"). Claude picks from the `fred_series` catalogue
(seeded in `supabase/migrations/0002_seed_fred_series.sql`) and returns a
confidence; anything under 0.45 is left unmapped rather than tracked against the
wrong index. When nothing in the catalogue fits, the model proposes a FRED search
phrase, and the top result is adopted into the catalogue.

## How alert copy works

Two calls per alert:

1. **Research** — `web_search` server tool, asking what actually moved the
   market. Free text, so the model can cite what it found.
2. **Copy** — a schema-constrained call (`messages.parse`) turning those notes
   into a headline, a body under 180 characters, and two to four drivers.

If the research turns up nothing, the copy says the move is unexplained rather
than inventing a macro story.
