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
  | "partial_delivery"
  | "delivered"
  | "closed";

/**
 * Two orthogonal axes — payment progress and delivery progress — so the table
 * can filter each independently. derivePOStatus composes them into a single
 * label for the badge.
 *
 * `linnworks_status` is the only authoritative delivery signal. `delivery_date`
 * cannot be used: Linnworks initialises DateOfDelivery to the PO date when a
 * PO is created, so it is non-null for OPEN/PARTIAL POs too.
 */
export type PaymentStatus = "awaiting" | "deposit_paid" | "paid_in_full";
export type DeliveryStatus = "awaiting" | "partial" | "delivered";

export function paymentStatus(po: PurchaseOrder): PaymentStatus {
  const terms = po.payment_terms ?? "upfront";
  if (terms === "upfront") {
    return po.payment_amount ? "paid_in_full" : "awaiting";
  }
  if (terms === "deposit_balance") {
    if (po.deposit_amount && po.balance_amount) return "paid_in_full";
    if (po.deposit_amount) return "deposit_paid";
    return "awaiting";
  }
  if (terms === "on_ship") {
    return po.balance_amount ? "paid_in_full" : "awaiting";
  }
  return "awaiting";
}

export function deliveryStatus(po: PurchaseOrder): DeliveryStatus {
  const lws = (po.linnworks_status ?? "").toUpperCase();
  if (lws === "DELIVERED") return "delivered";
  if (lws === "PARTIAL") return "partial";
  return "awaiting";
}

export function derivePOStatus(po: PurchaseOrder): DerivedStatus {
  const dlv = deliveryStatus(po);
  if (dlv === "delivered") return "delivered";
  if (dlv === "partial") return "partial_delivery";

  const pmt = paymentStatus(po);
  if (pmt === "paid_in_full") return "paid_in_full";
  if (pmt === "deposit_paid") return "deposit_paid";

  // Awaiting: pick the variant that names the missing payment for the badge.
  const terms = po.payment_terms ?? "upfront";
  if (terms === "deposit_balance") return "awaiting_deposit";
  if (terms === "on_ship") return "awaiting_balance";
  return "awaiting_payment";
}

export const STATUS_ORDER: Record<DerivedStatus, number> = {
  awaiting_payment: 0,
  awaiting_deposit: 0,
  awaiting_balance: 0,
  deposit_paid: 1,
  paid_in_full: 2,
  partial_delivery: 3,
  delivered: 4,
  closed: 5,
};

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  awaiting_payment: "Awaiting payment",
  awaiting_deposit: "Awaiting deposit",
  awaiting_balance: "Awaiting balance",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
  partial_delivery: "Partial",
  delivered: "Delivered",
  closed: "Closed",
};

export function statusLabel(po: PurchaseOrder): string {
  const status = derivePOStatus(po);
  if (status === "partial_delivery" && po.line_count && po.delivered_lines_count != null) {
    return `Partial (${po.delivered_lines_count}/${po.line_count})`;
  }
  return STATUS_LABEL[status];
}
