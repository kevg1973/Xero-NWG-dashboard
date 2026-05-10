-- Add Linnworks supplier UUID so we can resolve supplier names in Phase 2
-- without losing the link from PO to supplier.
alter table public.purchase_orders
  add column if not exists linnworks_supplier_id text;

create index if not exists purchase_orders_linnworks_supplier_id_idx
  on public.purchase_orders (linnworks_supplier_id);
