-- Linnworks-owned line counters for each PO header.
-- Useful for surfacing partial-delivery state ("3 of 8 lines delivered").
alter table public.purchase_orders
  add column if not exists line_count integer,
  add column if not exists delivered_lines_count integer;
