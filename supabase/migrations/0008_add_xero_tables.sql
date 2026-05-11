-- Xero integration: OAuth token storage + snapshot table.
--
-- xero_auth holds a single row (id=1 enforced by check constraint) — this is
-- a single-user, single-tenant app. refresh_token is stored encrypted by the
-- backend (AES-256-GCM, key from XERO_ENCRYPTION_KEY env var). access_token
-- is short-lived and stored as-is. RLS denies all access from authed users;
-- only the backend's service_role connection touches this table, and the
-- frontend only sees a redacted view via /api/xero/status.
--
-- xero_snapshots mirrors the linnworks_financial_snapshots pattern — scalar
-- columns for the metrics we know we want plus raw_response jsonb for the
-- full Xero report payload, keyed on (snapshot_date, period_type).

create table if not exists public.xero_auth (
  id integer primary key default 1 check (id = 1),
  access_token text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  tenant_id text,
  tenant_name text,
  scope text,
  last_refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_xero_auth_updated_at on public.xero_auth;
create trigger trg_xero_auth_updated_at
before update on public.xero_auth
for each row execute function public.set_updated_at();

alter table public.xero_auth enable row level security;
-- No policies = no access for anon/authenticated. service_role bypasses RLS.

create table if not exists public.xero_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  period_type text not null check (period_type in ('mtd', 'trailing_90d', 'balance_sheet')),
  period_start date,
  period_end date,
  revenue numeric(14, 2),
  operating_expenses numeric(14, 2),
  cash_total numeric(14, 2),
  trade_receivables numeric(14, 2),
  trade_payables numeric(14, 2),
  raw_response jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_date, period_type)
);

create index if not exists xero_snapshots_period_idx
  on public.xero_snapshots (period_type, snapshot_date desc);

alter table public.xero_snapshots enable row level security;

drop policy if exists xero_snapshots_authed_read on public.xero_snapshots;
create policy xero_snapshots_authed_read on public.xero_snapshots
  for select to authenticated using (true);
