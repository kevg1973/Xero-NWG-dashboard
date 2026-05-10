-- Linnworks DateOfDelivery is the source of truth for deliveries.
-- Drop the user-editable actual_delivery_date and replace with delivery_date
-- (Linnworks-owned). Preserve any user-set actual_delivery_date as the
-- starting value for delivery_date — next sync will overwrite from Linnworks.

alter table public.purchase_orders
  add column if not exists delivery_date date;

update public.purchase_orders
  set delivery_date = actual_delivery_date
  where actual_delivery_date is not null
    and delivery_date is null;

alter table public.purchase_orders
  drop column if exists actual_delivery_date;
