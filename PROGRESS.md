# Northwest Guitars dashboard — progress and context

**Last updated**: 2026-05-11
**Owner**: Kevin Grey (kevg1973 on GitHub, kevg1973@gmail.com)
**Repo**: https://github.com/kevg1973/Xero-NWG-dashboard
**Local working dir**: `/Volumes/Music/Github/Xero-NWG-dashboard`

This file is a self-contained handoff for a new Claude session (Desktop or Code). Read it top-to-bottom and you should be able to continue work without re-asking foundational questions.

---

## 1. What this project is

A single-page management dashboard for **Northwest Guitars** (UK ecommerce business — guitar parts, runs on Linnworks + Xero + Shopify).

**The core problem**: Standard Xero P&L is misleading because Northwest Guitars places large supplier POs (£30–50k) from Korea/China/US, often on **50% deposit + balance** terms staged months apart. These hit Xero as costs immediately even though the stock won't sell for months, so monthly profitability looks lurchy and bank dips trigger false panic.

**The fix**: Reframe the financial picture around **working capital**, not P&L. Track real cash position, gross margin trends, outstanding POs (with payment progress), and cash composition.

**Refresh model**: Manual "Sync now" button on the dashboard + automated daily sync at 5pm UK.

---

## 2. Tech stack (decided 2026-05-09 kickoff)

| Layer | Choice | Hosted on |
|---|---|---|
| Database + auth | Supabase (Postgres, RLS-enabled) | Supabase Cloud, `eu-west-2` (London) |
| Backend API + cron | Node 22 + Express + TypeScript, `node-cron` | Railway |
| Frontend | React 18 + Vite + Tailwind + Recharts | Cloudflare Pages |
| Source control | Git | GitHub (`kevg1973/Xero-NWG-dashboard`) |

**Repo layout** (monorepo):
```
/backend           Node service deployed to Railway
  src/
    linnworks/     Auth, PO endpoints, sync orchestration
    routes/        Express routes (POST /api/sync)
    middleware/    Supabase JWT verification (requireAuth)
    db/            Supabase client + sync_log helpers
    cli/syncOnce.ts  Run a single sync from the command line
    cron.ts        Daily 5pm UK schedule (node-cron, in-process)
    env.ts         Zod-validated env config
    index.ts       Express bootstrap, CORS, health check
  .env             Local env (gitignored)
  .env.example
/frontend          Vite + React + Tailwind SPA
  src/
    pages/         Login, Dashboard
    components/    POsTable, POEditPanel
    lib/           supabase client, api helpers, types + derived-status logic
  .env             Local env (gitignored)
  .env.example
/supabase/migrations/   SQL applied to Supabase via MCP (archive only — not run by a migration tool)
README.md          User-facing setup instructions
Secrets.txt        Local-only credential dump (gitignored, see .gitignore)
```

---

## 3. Platforms in use — full detail

### 3.1 GitHub
- **Repo**: https://github.com/kevg1973/Xero-NWG-dashboard
- **Default branch**: `main`
- **Owner**: kevg1973
- **Visibility**: private (assumed — confirm if needed)
- **Recent commits** (top of `main`):
  - `c20e7cf` Allow dashboard.northwestguitars.co.uk in CORS
  - `7304c0d` Lock CORS to Pages.dev frontend + local dev
  - `03804db` Bump backend Node engine to >=22
  - `7af0035` Cap PO sync at rolling 12 months
  - `1f66fe7` end of phase 1
  - `95f1a59` Phase 1 polish: PO sync v2, structured payment terms, delivery from Linnworks
  - `c9bd7b5` Phase 1: Linnworks PO sync, Supabase schema, dashboard scaffold
- Both Railway and Cloudflare Pages auto-deploy on push to `main`.

### 3.2 Supabase
- **Project name**: `nwg-dashboard`
- **Org**: LeanPlan
- **Region**: `eu-west-2` (London)
- **Provisioned by**: Claude via MCP (Supabase MCP server)
- **Auth**: Email/password. Single user today; schema is RLS-enabled with policies open to any authenticated user, ready to switch to user-scoped policies later.
- **Tables** (Phase 1, see §5 for full schema):
  - `purchase_orders` — Linnworks-owned + user-editable columns, split-ownership invariant enforced in sync code
  - `sync_log` — every sync run (manual or cron), with detail / error / duration
  - `dashboard_thresholds` — seeded thresholds for green/amber/red on margin, working capital, runway
- **Keys used**:
  - `service_role` key → backend (bypasses RLS for sync)
  - `anon` key → frontend (subject to RLS)
- **MCP tools available**: `list_tables`, `apply_migration`, `execute_sql`, `get_logs`, `get_advisors`, etc. Schema changes are applied via `apply_migration` and archived to `supabase/migrations/`.

### 3.3 Railway (backend)
- **Project**: hosts the `/backend` service from this monorepo
- **Public URL**: https://xero-nwg-dashboard-production.up.railway.app (this is the `VITE_BACKEND_URL` on Cloudflare Pages)
- **Root directory**: `/backend`
- **Build**: Nixpacks autodetects Node; `npm run build` → `npm start`
- **Node engine**: pinned to `>=22` in `backend/package.json`
- **Cron**: runs **inside** the long-running web service via `node-cron`, **not** a separate Railway Cron job. `ENABLE_CRON=true` on Railway, off locally.
- **Required env vars on Railway**:
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
  LINNWORKS_DEBUG=false        # set true for verbose request/response logs
  XERO_CLIENT_ID=...
  XERO_CLIENT_SECRET=...
  XERO_REDIRECT_URI=https://xero-nwg-dashboard-production.up.railway.app/api/xero/callback
  XERO_ENCRYPTION_KEY=...       # base64 32-byte key. Generate: openssl rand -base64 32
  XERO_FRONTEND_URL=https://dashboard.northwestguitars.co.uk
  ```
- **Fallback plan**: If Railway ever stops the service to free resources, switch to a Railway Cron job that runs `npm run sync:once`.

### 3.4 Cloudflare Pages (frontend)
- **Project**: connected to the same GitHub repo
- **Root directory**: `/frontend`
- **Framework preset**: Vite
- **Build command**: `npm install && npm run build`
- **Output directory**: `dist`
- **Domains** (both allowed by backend CORS):
  - `https://xero-nwg-dashboard.pages.dev` (default Pages URL)
  - `https://dashboard.northwestguitars.co.uk` (custom domain — DNS in Cloudflare)
- **Required env vars on Pages (Production)**:
  ```
  VITE_SUPABASE_URL=...
  VITE_SUPABASE_ANON_KEY=...
  VITE_BACKEND_URL=https://<railway-domain>
  ```

### 3.5 Linnworks (data source — PO + financial summary)
- **Region**: EU
- **Auth host**: `https://api.linnworks.net/api/Auth/AuthorizeByApplication` (form-encoded `ApplicationId`, `ApplicationSecret`, `Token` → returns `{ Token, Server }`). All subsequent calls use the `Server` URL from the auth response, **never** hardcoded — survives Linnworks shard moves.
- **Permissions required on the Linnworks app**:
  - `Inventory.PurchaseOrder.SearchPurchaseOrderNode`
  - `Inventory.PurchaseOrder.ViewPurchaseOrderNode`
  - `Dashboards.GetFinancialSummary` (Phase 2, not yet used)
- **Endpoints in use**:
  - `POST {server}/api/PurchaseOrder/Search_PurchaseOrders2` — paged PO list. v2 endpoint (v1 is deprecated but still operational). Request body wraps params under a single form field `request` (JSON-stringified). Page size 200, rate limit 250/min.
  - `POST {server}/api/PurchaseOrder/Get_PurchaseOrder` — single PO header + lines (not yet wired in Phase 1).
- **Verified response shape** (2026-05-10):
  - Envelope: `{ Result: [...], TotalEntries, TotalPages, EntriesPerPage, PageNumber }` — note `Result`, not `Data`.
  - Header fields used: `pkPurchaseID` (capital ID), `ExternalInvoiceNumber`, `fkSupplierId`, `DateOfPurchase`, `QuotedDeliveryDate`, `DateOfDelivery`, `Currency`, `TotalCost` (supplier currency), `ConvertedGrandTotal` (pre-converted to GBP by Linnworks), `Status`, `LineCount`, `DeliveredLinesCount`.
- **Data quirks (important)**:
  - `DateOfDelivery` is **unreliable as a "delivered?" signal** — Linnworks initialises it to the PO date on creation, so every PO has a non-null `DateOfDelivery`. Verified: 3063/3063 POs had `delivery_date` set; only 3035 were actually `DELIVERED`.
  - **Only `linnworks_status` is authoritative.** Use `linnworks_status === 'DELIVERED'` as the gate. `delivery_date` is only meaningful to *display* once status is DELIVERED.
  - Status enum: `PENDING`, `OPEN`, `PARTIAL`, `DELIVERED`.
  - Real PO history is ~3000 records (we initially assumed ~340).
- **FX handling**: Linnworks' `ConvertedGrandTotal` is already GBP, using Linnworks' own FX rate (which matches what Kevin sees in the Linnworks UI — consistent with his mental model). We store `TotalCost` → `po_value_original` and `ConvertedGrandTotal` → `po_value_gbp` directly. **No external FX API needed.**
- **Sync window**: Rolling 12 months only (commit `7af0035`). Tradeoff: edits to >12mo POs in Linnworks won't propagate until a manual full sync. Acceptable for Phase 1.

### 3.6 Xero (data source — Phase 2, not yet integrated)
- Will provide P&L + balance sheet
- **Auth model**: OAuth2 with refresh tokens. Static client ID + secret in env vars; refresh tokens stored in Supabase (encrypted column), with a small in-app screen to re-trigger consent when tokens expire.
- Anthropic-side: a Xero MCP server is available (`mcp__claude_ai_Xero__*` tools) for ad-hoc data probing during development.

### 3.7 Local development secrets
- `Secrets.txt` at repo root (gitignored) is Kevin's local credential dump.
- `backend/.env` and `frontend/.env` are gitignored and hold the values for local dev.

---

## 4. Phase plan and where we are

**Phase 1 — COMPLETE** (`1f66fe7` "end of phase 1" + subsequent polish):
- Supabase schema with split-ownership invariant on `purchase_orders`
- Supabase email/password auth (single user)
- Linnworks PO sync via Search_PurchaseOrders2 (rolling 12 months)
- Idempotent upsert — sync only touches Linnworks-owned columns, never user-editable ones
- Manual `POST /api/sync` endpoint (Bearer auth via Supabase JWT)
- Daily cron at 5pm UK via in-process `node-cron`
- CLI script: `npm run sync:once` for manual one-shot syncs from a dev machine
- Frontend: login screen, dashboard header with last-synced timestamp + "Sync now" button, POs table with filters (payment / delivery) + status badges + inline edit panel
- CORS locked down to the two production frontends + localhost:5173

**Phase 2 — IN PROGRESS**:
- ✅ Supplier name resolution (2026-05-11): `Inventory/GetSuppliers` endpoint returns the full UUID→name list as a plain JSON array. New `suppliers` table caches it; PO sync runs supplier sync first, then writes `supplier_name` onto each PO row at upsert time. Frontend reads the cached name, falls back to "Unknown supplier" for historical POs with deleted suppliers (~99 POs from 2012–2023).
- ✅ Linnworks Financial Summary sync (2026-05-11): `Dashboards/GetFinancialSummary` endpoint pulled twice per sync — MTD (1st of month → today) and trailing 90d. New `linnworks_financial_snapshots` table keyed on `(snapshot_date, period_type)`. Scalar columns (sales/refunds/purchases/stock_*) come from the **GBP** currency entry — not the `Combined` rollup, which is polluted by Linnworks' "Unknown" currency bucket with garbage values (~9.9M in a 90d window for a £80k/quarter business). Full payload stored in `raw_response` jsonb. PO sync and financial sync run independently via `runSyncs()` orchestrator — failure of one does not stop the other; each writes its own `sync_log` entry.
- ✅ Xero integration (2026-05-11): OAuth2 authorization-code flow. Routes: `GET /api/xero/connect` (redirects to Xero), `GET /api/xero/callback` (token exchange + redirect back to frontend), `GET /api/xero/status` (auth-protected, surfaces connected/needs_reconnection/tenant_name). Tokens stored in single-row `xero_auth` table; **refresh_token encrypted at rest with AES-256-GCM** (key from `XERO_ENCRYPTION_KEY` env var). Refresh tokens rotate on every use — `saveAuth()` always persists the new one before returning. Reconnection state inferred from the most recent xero `sync_log` row. Reports pulled per sync into `xero_snapshots` (mtd / trailing_90d / balance_sheet) with `raw_response` jsonb. Xero is the third independent step in `runSyncs()` — failure does not affect PO or financial sync. Defensive label-based parse for Xero's nested rows-of-rows report shape.
- ✅ 12-month backfill script (2026-05-12): `npm run backfill` (`backend/src/cli/backfill.ts`, CLI-only, not a route). Window = 12 months back (default; `--months=N` to override): daily snapshots for the last 90 days, weekly (every Monday) for the preceding ~9 months, plus `balance_sheet` rows **only on month-end dates** (~12) — because Xero's BalanceSheet API rounds `date` to month-end, a mid-month historical balance_sheet row would carry that month's month-end AR/AP, a value in the future relative to the snapshot date; AR/AP move slowly enough that monthly resolution is the honest granularity (charts lerp between points). Cash/credit-card and both P&L series ARE genuinely daily-accurate historically (BankSummary honours arbitrary dates; P&L takes explicit from/to). Reuses `syncXeroSnapshots(asOf, {accountTypes, includeBalanceSheet})` / `syncFinancialSnapshots(asOf)` so backfilled rows are computed identically to live rows; `GET /Accounts` fetched once for the whole run. Idempotent (upsert on `(snapshot_date, period_type)`); resume-safe (`--skip-existing` is the default — re-run skips dates whose rows already exist; `--force` overrides). Flags: `--dry-run` (prints the date list + a one-call data-depth probe against the oldest target's 90d window + cost/runtime estimate, no writes), `--force`, `--months=N`, `--xero-only`, `--linnworks-only`. Rate limiting (50 req/60s sliding window) + `429`/`Retry-After` retry now live in `xeroGet()` — only ever trips during bulk runs; hardens the live sync too.

**Phase 3 — NOT STARTED**:
- Health indicator banner (green/amber/red based on `dashboard_thresholds`)
- Metric cards (cash, working capital, gross margin, runway)
- Trend charts via Recharts
- Cash composition chart
- Working-capital narrative view

---

## 5. Database schema

**Migrations applied** (archived in `supabase/migrations/`):
1. `0001_phase1_schema.sql` — initial tables, RLS, trigger
2. `0002_add_linnworks_supplier_id.sql` — supplier UUID column for Phase 2 name resolution
3. `0003_payment_terms_structured.sql` — payment_terms as constrained enum, added payment_amount/payment_date
4. `0004_drop_user_actual_delivery.sql` — replaced user-editable `actual_delivery_date` with Linnworks-owned `delivery_date`
5. `0005_add_line_counts.sql` — `line_count` + `delivered_lines_count` for partial-delivery display
6. `0006_add_suppliers_table.sql` — `suppliers` cache table (linnworks_supplier_id PK, supplier_name, updated_at) + RLS
7. `0007_add_financial_snapshots.sql` — `linnworks_financial_snapshots` table (snapshot_date, period_type, scalars + raw_response jsonb) unique on (snapshot_date, period_type) + RLS
8. `0008_add_xero_tables.sql` — `xero_auth` (single-row id=1 check, encrypted refresh_token, tenant_id, no RLS policies = service-role-only) + `xero_snapshots` (mtd/trailing_90d/balance_sheet, scalars + raw_response, RLS authed read)

**`purchase_orders`** — split ownership:

*Linnworks-owned (overwritten on every sync):*
- `linnworks_po_id` text unique (the `pkPurchaseID` from Linnworks)
- `linnworks_supplier_id` text (supplier UUID; name resolved in Phase 2)
- `po_number` text (Linnworks `ExternalInvoiceNumber`)
- `supplier_name` text (currently always null — Phase 2)
- `po_date` date
- `currency` text
- `po_value_original` numeric (supplier currency)
- `po_value_gbp` numeric (from `ConvertedGrandTotal`)
- `expected_delivery_date` date (from `QuotedDeliveryDate`)
- `delivery_date` date (from `DateOfDelivery` — only meaningful when status=DELIVERED)
- `linnworks_status` text (PENDING/OPEN/PARTIAL/DELIVERED)
- `line_count` int
- `delivered_lines_count` int
- `last_synced_at` timestamptz

*User-editable (NEVER overwritten by sync):*
- `payment_terms` text — enum: `upfront` / `deposit_balance` / `on_ship`
- `payment_amount` numeric, `payment_date` date — for upfront term
- `deposit_amount` numeric, `deposit_date` date — for deposit_balance term
- `balance_amount` numeric, `balance_date` date — for deposit_balance + on_ship terms
- `notes` text

Plus: `id` uuid pk, `updated_at` timestamptz (trigger-maintained).

**`sync_log`** — `{ source, trigger (manual|cron), ok, detail (jsonb), error, duration_ms, created_at }`. Source enum includes `linnworks_po`, `linnworks_financial`, `xero`, `manual`, `cron`.

**`dashboard_thresholds`** — `{ metric, value, description }`, seeded with:
- `gross_margin_green_min` = 50
- `gross_margin_amber_min` = 40
- `working_capital_amber_max_decline_pct` = 10
- `cash_runway_green_min_months` = 3
- `cash_runway_red_max_months` = 1

**RLS**: enabled on all three tables. `purchase_orders` and `dashboard_thresholds` policies allow any authenticated user full access. `sync_log` is read-only for authenticated users. Backend uses `service_role` and bypasses RLS for the sync job.

---

## 6. Key implementation details

### Sync idempotency (the most important invariant)
In `backend/src/linnworks/sync.ts`:
- The mapped row contains **only** Linnworks-owned columns.
- The upsert payload therefore omits payment/notes columns entirely.
- Postgres `UPDATE` leaves unmentioned columns alone → user edits survive resync.
- A pre-upsert select counts inserts/updates/unchanged for the sync_log detail.
- The pre-select deliberately **does not** use `.in(linnworks_po_id, [...])` — that puts the GUID list in the URL and triggers PostgREST 414s past ~200 rows. Full select on ~3000 thin rows is cheap.

### Linnworks auth caching
In `backend/src/linnworks/client.ts`:
- Session token cached in process memory.
- On 401 → re-auth once, retry once, then propagate.
- Concurrent auth requests share the same in-flight promise (`inflightAuth`).

### Frontend derived status
In `frontend/src/lib/types.ts` — two orthogonal axes:
- `paymentStatus(po)`: `awaiting` | `deposit_paid` | `paid_in_full` — derived from payment_terms + which amount fields are filled.
- `deliveryStatus(po)`: `awaiting` | `partial` | `delivered` — derived **only** from `linnworks_status`. Never use `delivery_date` for this.
- `derivePOStatus(po)` composes them into a single `DerivedStatus` for the badge. `STATUS_ORDER` controls table sort (awaiting-first).
- `statusLabel(po)` shows `Partial (3/8)` when `linnworks_status === 'PARTIAL'` and line counts are present.

### CORS
Backend allow-list (in `backend/src/index.ts`):
- `https://dashboard.northwestguitars.co.uk`
- `https://xero-nwg-dashboard.pages.dev`
- `http://localhost:5173`

### Auth flow
- Frontend signs in via Supabase email/password → gets a JWT.
- Every call to `POST /api/sync` sends `Authorization: Bearer <jwt>`.
- Backend `requireAuth` middleware calls `supabase.auth.getUser(token)` to verify; throws 401 if invalid.

---

## 7. Local dev commands

**Backend**:
```bash
cd backend
cp .env.example .env       # then fill in values
npm install
npm run dev                # tsx watch, http://localhost:8080
npm run sync:once          # one-shot sync from CLI, uses .env
npm run sync:once -- --full  # full mode (currently identical to incremental)
npm run backfill -- --dry-run   # 12-month historical backfill: preview the plan
npm run backfill           # ...and execute it (resume-safe; --force / --months=N / --xero-only / --linnworks-only)
npm run mark-historic-paid              # one-shot: preview marking pre-2026-03-15 never-paid POs as paid-in-full (dry run)
npm run mark-historic-paid -- --force   # ...and execute (calls SQL fn mark_historic_pos_paid; idempotent; safe to drop the fn after)
npm run typecheck
```

**Frontend**:
```bash
cd frontend
cp .env.example .env       # VITE_BACKEND_URL=http://localhost:8080 for local
npm install
npm run dev                # http://localhost:5173
npm run typecheck
```

**Useful health check**: `curl https://xero-nwg-dashboard-production.up.railway.app/health` → `{ ok: true, env: "production" }`

---

## 8. Open questions / known gaps

- **PO sync diagnostic counts misreport inserts vs updates**: The pre-upsert SELECT in `backend/src/linnworks/sync.ts` reads the whole `purchase_orders` table to build an existingMap. Supabase JS caps `.select()` at 1000 rows by default; with ~3000 rows the map is incomplete, so rows past that cap get classified as "inserts" even though they exist. The `.upsert(... onConflict ...)` itself is correct — only the reported inserts/updates/unchanged counts are wrong. Fix: add `.range(0, 9999)` or paginate the SELECT.
- **Foreign-currency rollup in financial snapshots**: We pick the GBP entry. Linnworks' `Combined` rollup is unreliable when "Unknown" currency rows exist. If we ever want true multi-currency totals, query `raw_response` jsonb directly.
- **~1-day skew between the Linnworks and Xero sides of a snapshot**: `syncFinancialSnapshots` (via `buildPeriods`) computes a period's `end` as 00:00 of the snapshot date, while `syncXeroSnapshots` passes the snapshot date to Xero's report `toDate`, which Xero treats as inclusive of that whole day. So for the same `snapshot_date`, the Linnworks figures stop ~1 day "earlier" than the Xero figures. Invisible at chart resolution; not worth the churn to align. The backfill inherits this by design (it reuses both functions verbatim, so backfilled rows match live rows exactly).
- **`Search_PurchaseOrders` v1 deprecation**: We're on v2 already (`Search_PurchaseOrders2`), so this is handled. Watch Linnworks changelog in case they sunset v2 too.
- **Xero connection management** (built 2026-05-12): "Disconnect" link next to the `Xero · <tenant>` header indicator (`POST /api/xero/disconnect` — best-effort server-side token revocation, then deletes the `xero_auth` row). Dead-grant detection: when a refresh_token exchange is rejected by Xero (`invalid_grant`/400), `refreshTokens` sets `xero_auth.needs_reauth = true`; `/status` then returns `connected:false, needs_reconnection:true`, the dashboard shows an amber "Xero connection expired — Reconnect" banner + button, and `runSyncs` skips the Xero step (records `ok:true, detail:{skipped:"needs_reauth"}`) while Linnworks steps run normally. `saveAuth` clears `needs_reauth` on a successful (re)connect or refresh. To test the downstream UX without revoking: `UPDATE xero_auth SET needs_reauth = true WHERE id = 1;` then reload the dashboard.
- **Multi-user**: RLS policies are currently `authenticated → all rows`. When adding more users, swap for `user_id`-scoped policies. The seed setup keeps this easy to migrate.
- **Service token rotation**: Linnworks `Token` is the per-installation token. If it ever rotates we just update `LINNWORKS_TOKEN` on Railway.
- **`xero_snapshots.trade_payables` is near-zero by design** (≈£0–£1). NWG pays suppliers via wire transfer outside Xero, so the only bills posted into Xero's Accounts Payable are marketplace-fee residue from the Amazon/eBay journal-integration app. The real "what we owe to suppliers" lives in Linnworks PO deposits and is tracked separately by the dashboard. Do **not** treat a near-zero `trade_payables` as a sync bug.
- **`xero_snapshots.cogs` is "Purchases + Direct Wages expensed in period", not stock-shipped COGS.** This is a known accounting limitation of Xero's stock model for NWG — the accountant reconciles via stock-on-hand journals (out of scope for the dashboard). We capture Xero's number as-is; downstream gross-margin charts inherit the same caveat.
  - More precisely: Xero P&L COGS = Purchases + Direct Wages, **less any periodic stock-on-hand adjustment journals** posted to the "Cost of Goods Sold" account. Those adjustments are typically posted around the **April fiscal year-end** and land as one big lump in whatever period contains them (e.g. a −£192.6k credit sits in the 2025-02-11→2025-05-12 window, dragging that quarter's reported COGS down to ~£10k / ~96% gross margin; the same window's Direct Wages also spikes — a year-end true-up). Net effect on any trailing window: **gross margin looks artificially high if the window contains an adjustment journal, artificially low if it's before one is posted** (e.g. the current FY's year-end journal hasn't been posted yet, so the latest trailing-90d shows the "uncorrected" ~45% GM, COGS ≈ £159k).
  - The 12-month backfill writes these lumpy values **faithfully** — the historical gross-margin series will have a spike around March–April 2025 and a downward "correction" once the next year-end journal lands. Charts must **not** smooth this; any smoothing (e.g. using Linnworks `stock_shipped` as a true-COGS proxy, or amortising the adjustments) is downstream dashboard logic. The raw `xero_snapshots` rows stay faithful to Xero.
  - **UI build-time decision (trailing-90d gross-margin chart)**: derive gross margin from **`linnworks_financial_snapshots.stock_shipped`** (sign-flipped to positive — it's stored negative), **not** from `xero_snapshots.cogs`. Xero `cogs` is too lumpy due to the periodic stock-on-hand journals above; Linnworks `stock_shipped` is the proxy for true stock-out COGS until the accountant fixes the Xero side. Backfill evidence: 2025-05 trailing-90d window → Xero `cogs` £10k (post-adjustment) vs Linnworks `stock_shipped` −£135k → Linnworks is right; 2025-11 window (no journal lurking) → Xero `cogs` £111k vs Linnworks `stock_shipped` −£124k → they roughly agree. This is a chart-input choice only — `xero_snapshots.cogs`/`gross_profit` are still populated faithfully; the margin chart just won't consume them directly.
- **Xero BalanceSheet API rounds `date` to month-end.** No parameter combo (`timeframe`, `periods`, `standardLayout`, `paymentsOnly`) makes it honour mid-month dates — known multi-year API limitation; open UserVoice item. Empirically the data Xero returns within the current month reflects today's posted balances (just labeled with the upcoming month-end), so AR/AP daily snapshots still update day-to-day. To avoid the month-boundary discontinuity for cash specifically, **`cash_total` and `credit_card_liability` are sourced from `/Reports/BankSummary` (which does honour arbitrary dates), not from BalanceSheet.** `trade_receivables` and `trade_payables` still come from BalanceSheet. Both report fetches log Xero's reported period (stderr `[xero/BalanceSheet] requested=... xero_period="..." honoured=...`) so any future API behaviour change is visible without inspecting raw_response.
- **BankSummary mixes real bank accounts, PayPal, and credit cards** — Xero's BankSummary report sweeps in *every* account whose chart-of-accounts type is "bank", which includes credit-card accounts (NWG: American Express Platinum Busi, Capital on Tap) shown with positive closing balances (= amount owed). So we can't just sum the report. Each sync also calls `GET /Accounts` (needs `accounting.settings.read` scope) and classifies each BankSummary row by `BankAccountType`:
  - `BANK`, `PAYPAL` → `cash_total`
  - `CREDITCARD` → `credit_card_liability` (kept as its own metric, *not* netted out of cash — credit-card float on shorter-term purchases is a meaningful working-capital signal for NWG, not noise)
  - anything else / accountID not found in the chart of accounts → logged as a `[xero/BankSummary] WARNING unclassified bank account ...` line and excluded from both totals, so a newly-added account type can never silently land in the wrong bucket. **If you see that warning, add the new type to the classifier in `backend/src/xero/reports.ts:fetchBankSummary`.**
  - `cash_total`/`credit_card_liability` are null only if *no* rows could be classified (empty/unparseable report); a zero in either bucket is a real value.
- **Future: `working_capital` should subtract `credit_card_liability`** alongside `trade_payables` when those metric cards get built (not built yet). The data model captures it separately for exactly this reason.
- **Xero cash includes a negative PayPal balance reflecting marketplace journal mapping.** Xero's BankSummary shows PayPal GBP at roughly −£32k, almost certainly because the Amazon/eBay marketplace-fee journal-integration app is posting outflows without matching inflows to the actual PayPal processor balance. **Conversation with accountant pending; dashboard cash figure will run ~£32k below true cash position until resolved.** The dashboard is faithfully reporting what Xero says — this is upstream data hygiene, not a sync bug. (PayPal is deliberately kept in `cash_total`, not moved to credit-card liability — it *is* a cash account, just with a wrong balance.)

---

## 9. Working style / collaboration rules

These are durable preferences from Kevin (stored in Claude's memory system, surfaced here for portability):

- **Ask before making architectural assumptions.** Briefs end with explicit "things to ask before building" sections. If a decision isn't clearly covered, surface it as a question before writing code.
- **Phases are sequential.** Don't bundle Phase 2/3 work into Phase 1 PRs.
- **Idempotency on PO sync is sacred.** Never overwrite user-editable columns.
- **Design**: minimal, flat, sentence case, no decorative chrome.
- **Communication**: detailed briefs, comfortable with technical concepts, expects to direct architecture rather than retrofit it.

---

## 10. Quick links

- Repo: https://github.com/kevg1973/Xero-NWG-dashboard
- Production frontend: https://dashboard.northwestguitars.co.uk (also https://xero-nwg-dashboard.pages.dev)
- Linnworks developer portal: https://developer.linnworks.com/
- Supabase dashboard: https://supabase.com/dashboard (project `nwg-dashboard`)
- Railway: https://railway.app/ (project hosting `/backend`) — public URL https://xero-nwg-dashboard-production.up.railway.app
- Cloudflare Pages: https://pages.cloudflare.com/ (project hosting `/frontend`)
