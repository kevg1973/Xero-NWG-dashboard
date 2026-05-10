export type PaymentTerms = "upfront" | "deposit_balance" | "on_ship";

export const PAYMENT_TERMS_LABEL: Record<PaymentTerms, string> = {
  upfront: "Paid in full upfront",
  deposit_balance: "Deposit + balance",
  on_ship: "Paid in full on ship",
};

export type PurchaseOrder = {
  id: string;
  linnworks_po_id: string;
  linnworks_supplier_id: string | null;
  po_number: string | null;
  supplier_name: string | null;
  po_date: string | null;
  currency: string | null;
  po_value_original: number | null;
  po_value_gbp: number | null;
  expected_delivery_date: string | null;
  delivery_date: string | null;
  linnworks_status: string | null;
  line_count: number | null;
  delivered_lines_count: number | null;
  last_synced_at: string | null;

  payment_terms: PaymentTerms | null;
  payment_amount: number | null;
  payment_date: string | null;
  deposit_amount: number | null;
  deposit_date: string | null;
  balance_amount: number | null;
  balance_date: string | null;
  notes: string | null;

  updated_at: string;
};

export type DerivedStatus =
  | "awaiting_payment"
  | "awaiting_deposit"
  | "awaiting_balance"
  | "deposit_paid"
  | "paid_in_full"
  | "delivered"
  | "closed";

export function derivePOStatus(po: PurchaseOrder): DerivedStatus {
  if (po.delivery_date) return "delivered";

  const terms = po.payment_terms ?? "upfront";

  if (terms === "upfront") {
    return po.payment_amount ? "paid_in_full" : "awaiting_payment";
  }
  if (terms === "deposit_balance") {
    if (po.deposit_amount && po.balance_amount) return "paid_in_full";
    if (po.deposit_amount) return "deposit_paid";
    return "awaiting_deposit";
  }
  if (terms === "on_ship") {
    return po.balance_amount ? "paid_in_full" : "awaiting_balance";
  }
  return "awaiting_payment";
}

export const STATUS_ORDER: Record<DerivedStatus, number> = {
  awaiting_payment: 0,
  awaiting_deposit: 0,
  awaiting_balance: 0,
  deposit_paid: 1,
  paid_in_full: 2,
  delivered: 3,
  closed: 4,
};

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  awaiting_payment: "Awaiting payment",
  awaiting_deposit: "Awaiting deposit",
  awaiting_balance: "Awaiting balance",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
  delivered: "Delivered",
  closed: "Closed",
};
