-- Phase 1 schema for the NWG management dashboard.
-- Tables: purchase_orders, sync_log, dashboard_thresholds.

create extension if not exists "pgcrypto";

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),

  -- Linnworks-owned columns (overwritten on every sync)
  linnworks_po_id text not null unique,
  po_number text,
  supplier_name text,
  po_date date,
  currency text,
  po_value_original numeric(14, 2),
  po_value_gbp numeric(14, 2),
  expected_delivery_date date,
  linnworks_status text,
  last_synced_at timestamptz,

  -- User-editable columns (NEVER touched by sync — see linnworks/sync.ts)
  payment_terms text,
  deposit_amount numeric(14, 2),
  deposit_date date,
  balance_amount numeric(14, 2),
  balance_date date,
  actual_delivery_date date,
  notes text,

  updated_at timestamptz not null default now()
);

create index if not exists purchase_orders_po_date_idx on public.purchase_orders (po_date desc);
create index if not exists purchase_orders_linnworks_status_idx on public.purchase_orders (linnworks_status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_updated_at on public.purchase_orders;
create trigger trg_purchase_orders_updated_at
before update on public.purchase_orders
for each row execute function public.set_updated_at();

create table if not exists public.sync_log (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('linnworks_po', 'linnworks_financial', 'xero', 'manual', 'cron')),
  trigger text not null check (trigger in ('manual', 'cron')),
  ok boolean not null,
  detail jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists sync_log_created_at_idx on public.sync_log (created_at desc);

create table if not exists public.dashboard_thresholds (
  id uuid primary key default gen_random_uuid(),
  metric text not null unique,
  value numeric not null,
  description text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_dashboard_thresholds_updated_at on public.dashboard_thresholds;
create trigger trg_dashboard_thresholds_updated_at
before update on public.dashboard_thresholds
for each row execute function public.set_updated_at();

insert into public.dashboard_thresholds (metric, value, description) values
  ('gross_margin_green_min', 50, 'Trailing 90-day GM >= this is green'),
  ('gross_margin_amber_min', 40, 'GM in [amber_min, green_min) is amber; below is red'),
  ('working_capital_amber_max_decline_pct', 10, '3-month NWC decline > this %% is red; > 0 is amber'),
  ('cash_runway_green_min_months', 3, 'Cash / avg monthly opex >= this is green'),
  ('cash_runway_red_max_months', 1, 'Cash runway below this is red')
on conflict (metric) do nothing;

-- Row-level security. Single-user today, multi-user-ready: any authenticated
-- user can read/write all rows. When adding more users, swap these policies
-- for user_id-scoped ones. The backend uses the service role key and bypasses
-- RLS for the sync job.

alter table public.purchase_orders enable row level security;
alter table public.sync_log enable row level security;
alter table public.dashboard_thresholds enable row level security;

drop policy if exists purchase_orders_authed_all on public.purchase_orders;
create policy purchase_orders_authed_all on public.purchase_orders
  for all to authenticated using (true) with check (true);

drop policy if exists sync_log_authed_read on public.sync_log;
create policy sync_log_authed_read on public.sync_log
  for select to authenticated using (true);

drop policy if exists dashboard_thresholds_authed_all on public.dashboard_thresholds;
create policy dashboard_thresholds_authed_all on public.dashboard_thresholds
  for all to authenticated using (true) with check (true);
