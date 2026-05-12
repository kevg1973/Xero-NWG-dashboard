import { useEffect, useMemo, useState } from "react";
import {
  deliveryStatus,
  paymentStatus,
  type DeliveryStatus,
  type PaymentStatus,
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

const PAGE_SIZE = 50;

function supplierLabel(po: PurchaseOrder): string {
  return po.supplier_name ?? "Unknown supplier";
}

// "Settled" = nothing left to do: paid in full AND delivered. Hidden by default.
function isSettled(po: PurchaseOrder): boolean {
  return paymentStatus(po) === "paid_in_full" && deliveryStatus(po) === "delivered";
}

function matchesFilters(
  po: PurchaseOrder,
  pmt: PaymentFilter,
  dlv: DeliveryFilter,
  supplierQuery: string,
  showSettled: boolean,
): boolean {
  if (!showSettled && isSettled(po)) return false;
  if (pmt !== "any" && paymentStatus(po) !== pmt) return false;
  if (dlv !== "any" && deliveryStatus(po) !== dlv) return false;
  if (supplierQuery && !supplierLabel(po).toLowerCase().includes(supplierQuery.toLowerCase())) return false;
  return true;
}

// ---- status badges ----
const BADGE = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  orange: "bg-orange-100 text-orange-800",
  blue: "bg-sky-100 text-sky-800",
  neutral: "bg-ink-100 text-ink-700",
} as const;

function paymentBadge(po: PurchaseOrder): { label: string; cls: string } {
  const s = paymentStatus(po);
  if (s === "paid_in_full") return { label: "Paid in full", cls: BADGE.green };
  if (s === "deposit_paid") return { label: "Deposit paid", cls: BADGE.amber };
  // awaiting — name the payment that's missing for this terms type
  const terms = po.payment_terms ?? "upfront";
  if (terms === "deposit_balance") return { label: "Awaiting deposit", cls: BADGE.neutral };
  if (terms === "on_ship") return { label: "Awaiting balance", cls: BADGE.neutral };
  return { label: "Awaiting payment", cls: BADGE.neutral };
}

function deliveryBadge(po: PurchaseOrder): { label: string; cls: string } {
  const s = deliveryStatus(po);
  if (s === "delivered") return { label: "Delivered", cls: BADGE.blue };
  if (s === "partial") {
    const label =
      po.line_count && po.delivered_lines_count != null
        ? `Partial (${po.delivered_lines_count}/${po.line_count})`
        : "Partial";
    return { label, cls: BADGE.orange };
  }
  return { label: "Awaiting delivery", cls: BADGE.neutral };
}

// ---- sorting ----
type SortKey = "supplier" | "po_date" | "value" | "status" | "expected";
type SortDir = "asc" | "desc";

const SORTABLE_COLUMNS: Array<{ key: SortKey; label: string; align: "left" | "right" }> = [
  { key: "supplier", label: "Supplier", align: "left" },
  { key: "po_date", label: "PO date", align: "left" },
  { key: "value", label: "Value", align: "right" },
  { key: "status", label: "Status", align: "left" },
  { key: "expected", label: "Expected", align: "left" },
];

function poValue(po: PurchaseOrder): number | null {
  return po.po_value_gbp ?? po.po_value_original ?? null;
}

// The date shown in the "Expected" column: delivery_date once delivered, else the ETA.
function expectedDate(po: PurchaseOrder): string | null {
  if (po.linnworks_status === "DELIVERED" && po.delivery_date) return po.delivery_date;
  return po.expected_delivery_date;
}

// Status sort: payment status first (awaiting → deposit → paid), delivery second.
const PAYMENT_RANK: Record<PaymentStatus, number> = { awaiting: 0, deposit_paid: 1, paid_in_full: 2 };
const DELIVERY_RANK: Record<DeliveryStatus, number> = { awaiting: 0, partial: 1, delivered: 2 };
function statusRank(po: PurchaseOrder): number {
  return PAYMENT_RANK[paymentStatus(po)] * 10 + DELIVERY_RANK[deliveryStatus(po)];
}

function sortValue(po: PurchaseOrder, key: SortKey): string | number | null {
  switch (key) {
    case "supplier":
      return supplierLabel(po).toLowerCase();
    case "po_date":
      return po.po_date;
    case "value":
      return poValue(po);
    case "status":
      return statusRank(po);
    case "expected":
      return expectedDate(po);
  }
}

// Nulls always sort last, regardless of direction.
function compareBy(a: PurchaseOrder, b: PurchaseOrder, key: SortKey, dir: SortDir): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const r =
    typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? r : -r;
}

function defaultDirFor(key: SortKey): SortDir {
  // Supplier A→Z; Expected and Status default to "needs attention first" (asc);
  // amounts and PO date → biggest / most recent first.
  return key === "supplier" || key === "expected" || key === "status" ? "asc" : "desc";
}

// Page-number buttons to render: 1 … (cur-1) cur (cur+1) … last, collapsing as needed.
function pageWindow(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | "ellipsis"> = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  if (lo > 2) out.push("ellipsis");
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < total - 1) out.push("ellipsis");
  out.push(total);
  return out;
}

function fmtGbp(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

export function POsTable({ rows, onChange }: { rows: PurchaseOrder[]; onChange: () => void }) {
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("any");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("any");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [showSettled, setShowSettled] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("po_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDirFor(key));
    }
  }

  const visible = useMemo(() => {
    return rows
      .filter((po) => matchesFilters(po, paymentFilter, deliveryFilter, supplierQuery, showSettled))
      .sort((a, b) => {
        const r = compareBy(a, b, sortKey, sortDir);
        return r !== 0 ? r : (b.po_date ?? "").localeCompare(a.po_date ?? "");
      });
  }, [rows, paymentFilter, deliveryFilter, supplierQuery, showSettled, sortKey, sortDir]);

  // Any change to the visible set jumps back to page 1.
  useEffect(() => {
    setPage(1);
  }, [paymentFilter, deliveryFilter, supplierQuery, showSettled, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-300 flex-wrap">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-ink-500">
              Showing <span className="text-ink-900 font-medium">{visible.length}</span> of {rows.length} POs
            </span>
            <label className="flex items-center gap-1.5 text-ink-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showSettled}
                onChange={(e) => setShowSettled(e.target.checked)}
                className="accent-ink-900"
              />
              Show settled POs
            </label>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-500">Supplier</span>
              <input
                type="text"
                value={supplierQuery}
                onChange={(e) => setSupplierQuery(e.target.value)}
                placeholder="Search…"
                className="border border-ink-300 rounded px-2 py-1 text-sm bg-white w-40 focus:outline-none focus:ring-2 focus:ring-ink-700"
              />
            </label>
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
              {SORTABLE_COLUMNS.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={`${col.align === "right" ? "text-right" : "text-left"} font-semibold px-4 py-2.5 bg-ink-200 border-b border-ink-300 cursor-pointer select-none hover:bg-ink-300 ${active ? "text-ink-900" : ""}`}
                  >
                    {col.label}
                    <span className="ml-1 inline-block w-2">{active ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                  </th>
                );
              })}
              <th className="px-4 py-2.5 bg-ink-200 border-b border-ink-300"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-300">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                  No POs match this filter.
                </td>
              </tr>
            )}
            {pageRows.map((po) => {
              const pb = paymentBadge(po);
              const db = deliveryBadge(po);
              return (
                <tr key={po.id} className="hover:bg-ink-100/50">
                  <td className="px-4 py-3 font-medium text-ink-900">
                    {supplierLabel(po)}
                    {po.po_number && <div className="text-xs font-normal text-ink-500">{po.po_number}</div>}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{fmtDate(po.po_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                    {fmtGbp(poValue(po))}
                    {po.currency && po.currency !== "GBP" && (
                      <div className="text-xs text-ink-500">
                        {po.po_value_original?.toLocaleString("en-GB")} {po.currency}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${pb.cls}`}>
                        {pb.label}
                      </span>
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${db.cls}`}>
                        {db.label}
                      </span>
                    </span>
                  </td>
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
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(po)} className="text-xs text-ink-500 hover:text-ink-900">
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-ink-300 text-sm flex-wrap">
            <span className="text-ink-500">
              Page {safePage} of {pageCount} · rows {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={safePage === 1}
                onClick={() => setPage(safePage - 1)}
                className="px-2 py-0.5 rounded text-ink-700 hover:bg-ink-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                Previous
              </button>
              {pageWindow(safePage, pageCount).map((p, i) =>
                p === "ellipsis" ? (
                  <span key={`e${i}`} className="px-1.5 text-ink-500">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-2 py-0.5 rounded ${p === safePage ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-100"}`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                disabled={safePage === pageCount}
                onClick={() => setPage(safePage + 1)}
                className="px-2 py-0.5 rounded text-ink-700 hover:bg-ink-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                Next
              </button>
            </div>
          </div>
        )}
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
