import { useMemo, useState } from "react";
import {
  derivePOStatus,
  deliveryStatus,
  paymentStatus,
  statusLabel,
  STATUS_ORDER,
  type PurchaseOrder,
} from "../lib/types";
import { POEditPanel } from "./POEditPanel";

type PaymentFilter = "any" | "awaiting" | "deposit_paid" | "paid_in_full";
type DeliveryFilter = "any" | "awaiting" | "partial" | "delivered";

const PAYMENT_FILTER_LABEL: Record<PaymentFilter, string> = {
  any: "Any",
  awaiting: "Awaiting payment",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
};

const DELIVERY_FILTER_LABEL: Record<DeliveryFilter, string> = {
  any: "Any",
  awaiting: "Awaiting delivery",
  partial: "Partially delivered",
  delivered: "Delivered",
};

function matchesFilters(
  po: PurchaseOrder,
  pmt: PaymentFilter,
  dlv: DeliveryFilter,
): boolean {
  if (pmt !== "any" && paymentStatus(po) !== pmt) return false;
  if (dlv !== "any" && deliveryStatus(po) !== dlv) return false;
  return true;
}

function fmtGbp(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  });
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

function paidLabel(po: PurchaseOrder): string {
  const terms = po.payment_terms ?? "upfront";
  if (terms === "upfront") {
    return po.payment_amount ? `${fmtGbp(po.payment_amount)} (full)` : "—";
  }
  if (terms === "deposit_balance") {
    const dep = po.deposit_amount;
    const bal = po.balance_amount;
    if (dep && bal) return `${fmtGbp(dep + bal)} (full)`;
    if (dep) return `${fmtGbp(dep)} dep`;
    return "—";
  }
  return po.balance_amount ? `${fmtGbp(po.balance_amount)} (full)` : "—";
}

const STATUS_BADGE: Record<ReturnType<typeof derivePOStatus>, string> = {
  awaiting_payment: "bg-ink-100 text-ink-700",
  awaiting_deposit: "bg-ink-100 text-ink-700",
  awaiting_balance: "bg-ink-100 text-ink-700",
  deposit_paid: "bg-amber-100 text-amber-800",
  paid_in_full: "bg-emerald-100 text-emerald-800",
  partial_delivery: "bg-orange-100 text-orange-800",
  delivered: "bg-sky-100 text-sky-800",
  closed: "bg-ink-100 text-ink-500",
};

export function POsTable({
  rows,
  onChange,
}: {
  rows: PurchaseOrder[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("any");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("any");

  const visible = useMemo(() => {
    return rows
      .filter((po) => matchesFilters(po, paymentFilter, deliveryFilter))
      .sort((a, b) => {
        const sa = STATUS_ORDER[derivePOStatus(a)];
        const sb = STATUS_ORDER[derivePOStatus(b)];
        if (sa !== sb) return sa - sb;
        const da = a.po_date ?? "";
        const db = b.po_date ?? "";
        return db.localeCompare(da);
      });
  }, [rows, paymentFilter, deliveryFilter]);

  if (!rows.length) {
    return (
      <div className="bg-white border border-ink-300 rounded-lg p-10 text-center text-sm text-ink-500">
        No purchase orders yet. Hit "Sync now" to pull from Linnworks.
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-ink-300 rounded-lg">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-300">
          <div className="text-sm text-ink-500">
            Showing <span className="text-ink-900 font-medium">{visible.length}</span> of {rows.length} POs
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-500">Payment</span>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
                className="border border-ink-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ink-700"
              >
                {(Object.keys(PAYMENT_FILTER_LABEL) as PaymentFilter[]).map((key) => (
                  <option key={key} value={key}>
                    {PAYMENT_FILTER_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-500">Delivery</span>
              <select
                value={deliveryFilter}
                onChange={(e) => setDeliveryFilter(e.target.value as DeliveryFilter)}
                className="border border-ink-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ink-700"
              >
                {(Object.keys(DELIVERY_FILTER_LABEL) as DeliveryFilter[]).map((key) => (
                  <option key={key} value={key}>
                    {DELIVERY_FILTER_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 text-ink-700 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5 bg-ink-200 border-b border-ink-300">Supplier</th>
              <th className="text-left font-semibold px-4 py-2.5 bg-ink-200 border-b border-ink-300">PO date</th>
              <th className="text-right font-semibold px-4 py-2.5 bg-ink-200 border-b border-ink-300">Value</th>
              <th className="text-left font-semibold px-4 py-2.5 bg-ink-200 border-b border-ink-300">Paid</th>
              <th className="text-left font-semibold px-4 py-2.5 bg-ink-200 border-b border-ink-300">Expected</th>
              <th className="text-left font-semibold px-4 py-2.5 bg-ink-200 border-b border-ink-300">Status</th>
              <th className="px-4 py-2.5 bg-ink-200 border-b border-ink-300"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-300">
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-ink-500"
                >
                  No POs match this filter.
                </td>
              </tr>
            )}
            {visible.map((po) => {
              const status = derivePOStatus(po);
              const supplier = po.supplier_name ?? "Unknown supplier";
              return (
                <tr key={po.id} className="hover:bg-ink-100/50">
                  <td className="px-4 py-3 font-medium text-ink-900">
                    {supplier}
                    {po.po_number && (
                      <div className="text-xs font-normal text-ink-500">{po.po_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{fmtDate(po.po_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                    {fmtGbp(po.po_value_gbp ?? po.po_value_original)}
                    {po.currency && po.currency !== "GBP" && (
                      <div className="text-xs text-ink-500">
                        {po.po_value_original?.toLocaleString("en-GB")} {po.currency}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700 tabular-nums">{paidLabel(po)}</td>
                  <td className="px-4 py-3 text-ink-700">
                    {po.linnworks_status === "DELIVERED" && po.delivery_date ? (
                      <span>
                        {fmtDate(po.delivery_date)}
                        <span className="text-xs text-ink-500 ml-1">delivered</span>
                      </span>
                    ) : (
                      fmtDate(po.expected_delivery_date)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[status]}`}
                    >
                      {statusLabel(po)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(po)}
                      className="text-xs text-ink-500 hover:text-ink-900"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <POEditPanel
          po={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
    </>
  );
}
