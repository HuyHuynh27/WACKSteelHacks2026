# Better RAW

A dashboard PWA that tracks what a business's raw materials cost, rolls those
costs up through the bill of materials, and pushes a plain-English summary when
prices move — the size of the move *and* what drove it.

> "Aluminum +6.2% this week — smelter outages in Yunnan and higher power costs
> are the drivers."

## What it does

- **Material ledger.** Add each raw material with its unit, supplier, SKU and
  what you currently pay. Claude maps the name you use ("6061 aluminium
  extrusion") onto a public FRED price series.
- **Price history.** A daily job backfills and extends each material's series.
  Record your own invoice prices alongside it to see the spread between the
  market and your supplier.
- **Cost roll-up.** Attach materials to a product and its unit cost
  recalculates from the latest prices — a SQL view, not application code.
- **Push alerts, opt-in.** Web push with a summary of the move and the drivers
  behind it. Per-material thresholds, an account-wide floor, quiet hours.
- **Installable.** Manifest plus service worker, with an offline shell.

## Stack

| Layer      | Choice                                                            |
| ---------- | ----------------------------------------------------------------- |
| Frontend   | Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui        |
| Charts     | Recharts                                                          |
| Data & auth| Supabase — Postgres, email/password auth, row-level security       |
| Ingestion  | Python, on a scheduled GitHub Action                               |
| Push       | `web-push` + a VAPID keypair, subscriptions in Postgres            |
| LLM        | Claude API — material→series mapping, and the notification copy    |
| Deploy     | Vercel                                                            |

## Layout

```
src/app/(app)/        dashboard, materials, products, alerts, settings
src/app/api/push/     subscribe · unsubscribe · test · dispatch
src/components/       charts/, pwa/, ui/ (shadcn)
src/lib/supabase/     browser · server · session (proxy) clients
supabase/migrations/  schema + RLS, and the FRED series catalogue
ingestion/            the Python worker — map · sync · alerts · dispatch
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
- `ANTHROPIC_API_KEY` — from the Anthropic Console
- `CRON_SECRET` — any long random string; the worker sends it to the dispatch
  route

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

## Deploying

Push to GitHub, import the repo on Vercel, and set every variable from
`.env.example` **except** the ingestion-only ones (`FRED_API_KEY`,
`ANTHROPIC_API_KEY`). Set `APP_BASE_URL` to the deployed URL.

For the scheduled worker, add these as GitHub Actions **secrets** —
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`,
`ANTHROPIC_API_KEY`, `CRON_SECRET` — and `APP_BASE_URL` as a repository
**variable**.

## Notes

- Icons are generated, not committed by hand: `node scripts/generate-icons.mjs`.
- Chart colours are validated for colour-vision deficiency and contrast in both
  light and dark mode; the tokens live in `src/app/globals.css` under
  `.viz-root`.
- iOS only allows web push once the app is installed to the Home Screen.
