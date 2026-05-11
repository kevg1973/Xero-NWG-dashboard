-- Suppliers cache. Linnworks' Search_PurchaseOrders2 only returns fkSupplierId
-- (UUID); Inventory/GetSuppliers returns the UUID→name mapping. We snapshot
-- the supplier list before each PO sync and write supplier_name onto the
-- purchase_orders row at upsert time, so the frontend can read it without a
-- join. The suppliers table is the system of record.

create table if not exists public.suppliers (
  linnworks_supplier_id text primary key,
  supplier_name text not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;

drop policy if exists suppliers_authed_read on public.suppliers;
create policy suppliers_authed_read on public.suppliers
  for select to authenticated using (true);
