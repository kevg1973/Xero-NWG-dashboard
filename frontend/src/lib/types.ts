export type PurchaseOrder = {
  id: string;
  linnworks_po_id: string;
  po_number: string | null;
  supplier_name: string | null;
  po_date: string | null;
  currency: string | null;
  po_value_original: number | null;
  po_value_gbp: number | null;
  expected_delivery_date: string | null;
  linnworks_status: string | null;
  last_synced_at: string | null;

  payment_terms: string | null;
  deposit_amount: number | null;
  deposit_date: string | null;
  balance_amount: number | null;
  balance_date: string | null;
  actual_delivery_date: string | null;
  notes: string | null;

  updated_at: string;
};

export type DerivedStatus =
  | "open"
  | "deposit_paid"
  | "paid_in_full"
  | "delivered"
  | "closed";

export function derivePOStatus(po: PurchaseOrder): DerivedStatus {
  if (po.actual_delivery_date) return "delivered";
  if (po.deposit_amount && po.balance_amount) return "paid_in_full";
  if (po.deposit_amount) return "deposit_paid";
  return "open";
}

export const STATUS_ORDER: Record<DerivedStatus, number> = {
  open: 0,
  deposit_paid: 1,
  paid_in_full: 2,
  delivered: 3,
  closed: 4,
};

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  open: "Open",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
  delivered: "Delivered",
  closed: "Closed",
};
