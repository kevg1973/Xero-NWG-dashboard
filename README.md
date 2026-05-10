# Northwest Guitars dashboard

Single-page management dashboard for Northwest Guitars. Reframes Xero P&L through a working-capital lens so large staged supplier POs don't make monthly profitability look lurchy.

## Stack

- **Database / auth**: Supabase (Postgres + auth, RLS-enabled)
- **Backend**: Node.js (Express + TypeScript) on Railway, daily cron via `node-cron`
- **Frontend**: React + Vite + Tailwind on Cloudflare Pages
- **Data sources**: Linnworks (PO + financial summary), Xero (P&L + balance sheet) — Xero arrives in Phase 2

## Repo layout

```
backend/                Node.js service deployed to Railway
  src/
    linnworks/          Auth, PO endpoints, sync orchestration
    routes/             Express routes (POST /api/sync)
    middleware/         Supabase JWT verification
    db/                 Supabase client + sync_log helpers
    cli/syncOnce.ts     Run a single sync from the command line
    cron.ts             Daily 5pm UK schedule
  .env.example
frontend/               Vite + React + Tailwind SPA
  src/
    pages/              Login, Dashboard
    components/         POs table + edit panel
    lib/                Supabase client, backend API helpers, types
  .env.example
supabase/migrations/    Archive of SQL applied to Supabase (applied via MCP)
```

## Phases

- **Phase 1** *(this commit)* — Supabase schema + auth, Linnworks PO sync, manual sync endpoint, daily cron, frontend with login + POs table + inline edit.
- **Phase 2** — Linnworks Financial Summary sync, Xero integration, snapshot tables, 12-month backfill.
- **Phase 3** — Health indicator banner, metric cards, trend charts, cash composition chart.

## One-time setup

### 1. Supabase (already done by Claude via MCP)

The `nwg-dashboard` project is already created in the LeanPlan org, region `eu-west-2` (London). The Phase 1 schema is applied. To grab the credentials:

1. Open [your Supabase project](https://supabase.com/dashboard/project/_/settings/api)
2. Copy:
   - `Project URL` → `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend)
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (backend, **never** expose in frontend)
   - `anon` key → `VITE_SUPABASE_ANON_KEY` (frontend)
3. Create your user:
   - Authentication → Users → Add user → Create new user
   - Email/password (auto-confirm)

### 2. Linnworks app

1. Log into [Linnworks Developer Portal](https://developer.linnworks.com/)
2. Create a new application (or reuse existing). You need:
   - `ApplicationId`
   - `ApplicationSecret`
   - `Token` (the per-installation token after the app is installed against your Linnworks account)
3. Make sure the app has these permissions:
   - `Inventory.PurchaseOrder.SearchPurchaseOrderNode`
   - `Inventory.PurchaseOrder.ViewPurchaseOrderNode`
   - `Dashboards.GetFinancialSummary` (Phase 2)

### 3. Railway (backend)

1. [railway.app](https://railway.app/) → New Project → Deploy from GitHub repo → pick `kevg1973/Xero-NWG-dashboard`
2. Settings → Root Directory: `/backend`
3. Settings → Build: leave defaults (Nixpacks autodetects Node)
4. Settings → Start Command: `npm start` (after `npm run build` runs in build step — Railway does this by default)
5. Variables → set:
   ```
   PORT=8080
   NODE_ENV=production
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   LINNWORKS_APPLICATION_ID=...
   LINNWORKS_APPLICATION_SECRET=...
   LINNWORKS_TOKEN=...
   ENABLE_CRON=true
   SYNC_CRON_EXPRESSION=0 17 * * *
   SYNC_CRON_TZ=Europe/London
   ```
6. Settings → Networking → Generate domain. Note the URL (e.g. `nwg-dashboard-backend.up.railway.app`).

> The cron runs inside the long-running web service. Railway also has a separate "Cron" feature (separate process, runs on a schedule and exits) — we're using the in-process node-cron approach so a single deployment covers both the API and the schedule. If Railway ever stops your service to free resources, switch to a Railway Cron job that calls `npm run sync:once`.

### 4. Cloudflare Pages (frontend)

1. [pages.cloudflare.com](https://pages.cloudflare.com/) → Create project → Connect to GitHub → pick `kevg1973/Xero-NWG-dashboard`
2. Build settings:
   - Framework preset: `Vite`
   - Build command: `npm install && npm run build`
   - Build output directory: `dist`
   - Root directory: `/frontend`
3. Environment variables (Production):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_BACKEND_URL=https://<your-railway-domain>
   ```
4. Save and Deploy.

> The first deploy will fail if env vars aren't set — set them, then re-trigger via Deployments → Retry.

## Local development

### Backend

```bash
cd backend
cp .env.example .env
# fill in values
npm install
npm run dev          # http://localhost:8080
npm run sync:once    # one-shot sync from CLI (uses .env)
```

### Frontend

```bash
cd frontend
cp .env.example .env
# fill in values; VITE_BACKEND_URL=http://localhost:8080 for local
npm install
npm run dev          # http://localhost:5173
```

## Sync logic

- **Idempotent**: PO sync only updates Linnworks-owned columns (`po_number`, `supplier_name`, `po_date`, `currency`, `po_value_*`, `expected_delivery_date`, `linnworks_status`, `last_synced_at`). User-edited fields (`payment_terms`, `deposit_*`, `balance_*`, `actual_delivery_date`, `notes`) are never overwritten on resync.
- **Auth caching**: Linnworks session token cached in process memory. On 401, the client re-auths once and retries.
- **Server URL**: comes from the auth response (`Server` field), not hardcoded. Survives Linnworks shard moves.

## Known issues / open decisions

- `Search_PurchaseOrders` is technically marked deprecated in Linnworks docs but is still the operational paged-listing endpoint. Watch the Linnworks changelog for a v2 replacement.
- FX strategy for non-GBP POs: currently we trust whatever Linnworks returns. If `TotalCost` + `ConversionRate` are populated, we derive GBP. If not, `po_value_gbp` is left null and the UI falls back to `po_value_original`. Revisit once we have real PO data to inspect.
