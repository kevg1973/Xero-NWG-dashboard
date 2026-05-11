-- Daily snapshots from Linnworks Dashboards/GetFinancialSummary.
-- Two period_types per snapshot day: 'mtd' (1st of current month → today) and
-- 'trailing_90d' (today − 90 days → today). Unique constraint on
-- (snapshot_date, period_type) lets a same-day re-run overwrite cleanly.
--
-- Scalar columns come from the "Combined" currency entry in the response —
-- Linnworks has already done the multi-currency rollup to GBP-equivalent.
-- raw_response keeps the full payload so we can surface more later without
-- another sync (or migration).

create table if not exists public.linnworks_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  period_type text not null check (period_type in ('mtd', 'trailing_90d')),
  period_start date not null,
  period_end date not null,
  sales_total numeric(14, 2),
  refunds_total numeric(14, 2),
  purchases_total numeric(14, 2),
  stock_begin numeric(14, 2),
  stock_shipped numeric(14, 2),
  stock_scrapped numeric(14, 2),
  stock_returned numeric(14, 2),
  stock_added numeric(14, 2),
  raw_response jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_date, period_type)
);

create index if not exists linnworks_financial_snapshots_period_idx
  on public.linnworks_financial_snapshots (period_type, snapshot_date desc);

alter table public.linnworks_financial_snapshots enable row level security;

drop policy if exists financial_snapshots_authed_read on public.linnworks_financial_snapshots;
create policy financial_snapshots_authed_read on public.linnworks_financial_snapshots
  for select to authenticated using (true);
