# Better RAW

A dashboard PWA that tracks what a business's raw materials cost, rolls those
costs up through the bill of materials, and pushes a plain-English summary when
prices move — the size of the move *and* what drove it.

> "Aluminum +6.2% this week — smelter outages in Yunnan and higher power costs
> are the drivers."

## What it does

- **Material ledger.** Add each raw material with its unit, supplier, SKU and
  what you currently pay. Nemotron maps the name you use ("6061 aluminium
  extrusion") onto a public FRED price series, with a confidence score — below
  0.45 the material is left unmapped rather than tracked against the wrong
  index.
- **Price history, in your unit.** A daily job backfills and extends each
  material's series. FRED quotes aluminum per metric ton; a shop buys 6061 by
  the pound, so prices are converted on the way in. Record your own invoice
  prices alongside to see the spread between the market and your supplier.
- **Cost roll-up.** Attach materials to a product and its unit cost
  recalculates from the latest prices — a SQL view, not application code.
- **Push alerts, opt-in.** Web push with a summary of the move and the drivers
  behind it, each driver linked to a source the research pass actually
  retrieved. Per-material thresholds, an account-wide floor, quiet hours.
- **Ask about a material.** `/api/query` answers free-text questions grounded
  in that material's price history and existing alerts.
- **Installable.** Manifest plus service worker, with an offline shell.

## Stack

| Layer      | Choice                                                            |
| ---------- | ----------------------------------------------------------------- |
| Frontend   | Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui        |
| Charts     | Recharts                                                          |
| Data & auth| Supabase — Postgres, email/password auth, row-level security       |
| Ingestion  | Python, on a scheduled GitHub Action                               |
| Push       | `web-push` + a VAPID keypair, subscriptions in Postgres            |
| LLM        | NVIDIA Nemotron 3 Super, via the OpenAI-compatible endpoint at `integrate.api.nvidia.com` |
| Search     | DuckDuckGo (`ddgs`), driven by a hand-rolled tool loop            |
| Deploy     | Vercel                                                            |

## Where the model sits

Nemotron does three jobs, none of them conversational:

1. **Classification with a gate** (`ingestion/better_raw/mapper.py`). Picks a
   FRED series from a seeded catalogue and returns a calibrated confidence.
   The confidence — not the model's prose — decides whether the mapping is
   written.
2. **Research and structured generation** (`ingestion/better_raw/alerts.py`).
   Two calls per alert: a tool loop that searches for what moved the market,
   then a schema-constrained pass turning those notes into a headline, body and
   two to four drivers.
3. **Query-time synthesis** (`src/lib/rag/synthesize.ts`). Answers a user's
   question from the alerts and price history already in Postgres. It does not
   search — that work happened once, at ingestion.

Two things the model is deliberately *not* trusted with:

- **Unit arithmetic.** Conversion factors come from a lookup table
  (`ingestion/better_raw/units.py`). A hallucinated 2204.62 would corrupt every
  cost figure downstream with no visible symptom.
- **Citations.** `research()` records every URL the search returned and
  `_verify_sources()` nulls any source outside that set. The model reliably
  emits confident-looking URLs that map to nothing; no prompt wording prevents
  it.

Series quoted as an index (a PPI, say) have no absolute price, so they are
flagged `price_is_index` and excluded from cost roll-ups. They still track
percentage moves, which is all the alert detector needs.

## Layout

```
src/app/(app)/        dashboard, materials, products, alerts, settings
src/app/api/push/     subscribe · unsubscribe · test · dispatch · ...
src/app/api/query/    grounded Q&A over a material's alerts
src/lib/rag/          retrieval over alerts, and answer synthesis
src/lib/supabase/     browser · server · session (proxy) clients
src/components/       charts/, pwa/, ui/ (shadcn)
supabase/migrations/  schema + RLS, and the FRED series catalogue
ingestion/            the Python worker — map · sync · alerts · dispatch
ingestion/better_raw/units.py   FRED units -> the shop's purchasing unit
```

## Getting started

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Supabase

Create a project, then run the migrations in order against it — either paste
them into the SQL editor or, with the CLI linked:

```bash
npx supabase link --project-ref <your-ref>
npx supabase db push
```

Copy the project URL, anon key and service-role key into `.env.local`.

### 3. VAPID keys for push

```bash
npm run gen:vapid    # prints the three lines to paste into .env.local
```

### 4. Data and LLM keys

- `FRED_API_KEY` — free, from <https://fredaccount.stlouisfed.org/apikeys>
- `NVIDIA_API_KEY` — free, from <https://build.nvidia.com>. Needed by the
  worker *and* the web app, so it goes in the Vercel deployment too.
- `CRON_SECRET` — any long random string; the worker sends it to the dispatch
  route

No Anthropic key is required. Nothing in the project calls Claude.

### 5. Run it

```bash
npm run dev
```

Service worker registration is skipped in development — use `npm run build &&
npm start` to exercise the PWA and push end to end.

### 6. Feed it data

```bash
cd ingestion
pip install -r requirements.txt
python run.py all
```

See [`ingestion/README.md`](ingestion/README.md) for the individual steps.

## Notifications

Seven routes under `/api/push`. The VAPID private key lives only in the Next.js
deployment, so every send goes through here — the Python worker just asks.

| Route          | Auth                | What it does                                       |
| -------------- | ------------------- | -------------------------------------------------- |
| `subscribe`    | session             | Stores a device's subscription; flips the opt-in on |
| `unsubscribe`  | session             | Drops one device; opts out when it was the last     |
| `test`         | session             | Sends a sample alert to the caller's own devices    |
| `ack`          | session             | Marks an alert read when its notification is tapped |
| `rotate`       | knowledge of old endpoint | Re-points a subscription the browser rotated  |
| `vapid-key`    | public              | The public key, so the service worker can re-subscribe |
| `dispatch`     | `x-cron-secret`     | Fans pending alerts out to every eligible device    |

### How dispatch decides

The rules live in [`src/lib/notifications.ts`](src/lib/notifications.ts), kept
free of Supabase and `web-push` so they can be tested on their own — `npm test`.
Per user, per run:

1. **Not opted in, or no devices left?** Retire the alerts; they will never send.
2. **Under the account-wide `min_change_pct`?** Retire those. Each material's own
   `alert_threshold_pct` was already applied upstream by the worker.
3. **Inside quiet hours?** Leave them pending — the next run picks them up.
4. **`digest` is `instant`?** One notification per alert.
5. **`daily` or `weekly`?** Hold until `digest_sent_at` is old enough, then send a
   single batched notification led by the biggest mover.

An alert is marked delivered only once at least one device *accepted* it. If every
send fails it stays pending rather than vanishing. Subscriptions that come back
404/410 are pruned.

### Things that bite

- **Rotation is silent.** Browsers reissue subscriptions whenever they like and
  nothing tells the server. The service worker's `pushsubscriptionchange` handler
  posts to `rotate`; without it a device just stops receiving alerts.
- **iOS needs the Home Screen.** Safari only grants push once the PWA is
  installed, and only over HTTPS — test on the Vercel URL, not localhost.
- **Dev skips the service worker.** `ServiceWorkerRegistrar` no-ops in
  development; use `npm run build && npm start` to exercise push.
- **Check the keypair before blaming the browser:** `npm run verify:push`.
- **A wrong FRED series id is silent.** The material maps, the sync finds
  nothing, and the chart is just empty. `python verify_catalog.py` after
  editing the seed.

## Deploying

Push to GitHub, import the repo on Vercel, and set every variable from
`.env.example` **except** `SUPABASE_SERVICE_ROLE_KEY` and `FRED_API_KEY`, which
only the ingestion worker needs. `NVIDIA_API_KEY` *is* needed in Vercel —
`/api/query` calls Nemotron. Set `APP_BASE_URL` to the deployed URL.

For the scheduled worker, add these as GitHub Actions **secrets** —
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`,
`NVIDIA_API_KEY`, `CRON_SECRET` — and `APP_BASE_URL` as a repository
**variable**.

## Known limitations

- **Proxy series.** Some materials have no series of their own and are tracked
  against an input instead — 304 stainless against nickel. Nickel is roughly a
  tenth of the sheet's cost, so the tracked series moves further and faster
  than an invoice does. The material page says so; the confidence score is
  what flags it.
- **Unit coverage.** `units.py` handles mass, volume, energy and board feet. A
  material bought by the each, sheet, roll or linear foot has no conversion and
  its price is stored as the series quotes it.
- **Monthly series, weekly windows.** A 7-day change on a monthly PPI resolves
  to the same observation as the 30-day change.

## Notes

- Icons are generated, not committed by hand: `node scripts/generate-icons.mjs`.
- Chart colours are validated for colour-vision deficiency and contrast in both
  light and dark mode; the tokens live in `src/app/globals.css` under
  `.viz-root`.
- iOS only allows web push once the app is installed to the Home Screen.