-- Restructure payment tracking. payment_terms becomes a constrained enum
-- (upfront / deposit_balance / on_ship). Add payment_amount + payment_date for
-- the upfront variant. Existing rows default to 'upfront' with no payment —
-- they surface as "Awaiting payment" so Kevin can review each one.

alter table public.purchase_orders
  add column if not exists payment_amount numeric(14, 2),
  add column if not exists payment_date date;

update public.purchase_orders set payment_terms = 'upfront';

alter table public.purchase_orders
  drop constraint if exists payment_terms_check;
alter table public.purchase_orders
  add constraint payment_terms_check
  check (payment_terms in ('upfront', 'deposit_balance', 'on_ship'));

alter table public.purchase_orders
  alter column payment_terms set default 'upfront';
