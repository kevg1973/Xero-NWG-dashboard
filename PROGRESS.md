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
- Linnworks `GetFinancialSummary` sync (sales, refunds, purchases, stock movements)
- Xero OAuth flow + refresh-token storage in Supabase
- Xero P&L + balance sheet pull
- Snapshot tables for time-series (monthly aggregates)
- 12-month backfill script

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

- **Supplier names**: `supplier_name` column always null today. Phase 2 needs to call a Linnworks endpoint (e.g. `GetSupplier` or similar — endpoint TBD) and either backfill or resolve on the fly. UI shows "supplier name pending" placeholder.
- **`Search_PurchaseOrders` v1 deprecation**: We're on v2 already (`Search_PurchaseOrders2`), so this is handled. Watch Linnworks changelog in case they sunset v2 too.
- **Xero OAuth re-consent UI**: Not yet built. Phase 2.
- **Multi-user**: RLS policies are currently `authenticated → all rows`. When adding more users, swap for `user_id`-scoped policies. The seed setup keeps this easy to migrate.
- **Service token rotation**: Linnworks `Token` is the per-installation token. If it ever rotates we just update `LINNWORKS_TOKEN` on Railway.

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
