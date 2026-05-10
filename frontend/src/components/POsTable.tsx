import { useMemo, useState } from "react";
import {
  derivePOStatus,
  STATUS_LABEL,
  STATUS_ORDER,
  type PurchaseOrder,
} from "../lib/types";
import { POEditPanel } from "./POEditPanel";

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
  const dep = po.deposit_amount;
  const bal = po.balance_amount;
  if (dep && bal) return `${fmtGbp(dep + bal)} (full)`;
  if (dep) return `${fmtGbp(dep)} dep`;
  return "—";
}

const STATUS_BADGE: Record<ReturnType<typeof derivePOStatus>, string> = {
  open: "bg-ink-100 text-ink-700",
  deposit_paid: "bg-amber-100 text-amber-800",
  paid_in_full: "bg-emerald-100 text-emerald-800",
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

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const sa = STATUS_ORDER[derivePOStatus(a)];
      const sb = STATUS_ORDER[derivePOStatus(b)];
      if (sa !== sb) return sa - sb;
      const da = a.po_date ?? "";
      const db = b.po_date ?? "";
      return db.localeCompare(da);
    });
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="bg-white border border-ink-300 rounded-lg p-10 text-center text-sm text-ink-500">
        No purchase orders yet. Hit "Sync now" to pull from Linnworks.
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-ink-300 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-100 text-ink-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Supplier</th>
              <th className="text-left font-medium px-4 py-2.5">PO date</th>
              <th className="text-right font-medium px-4 py-2.5">Value</th>
              <th className="text-left font-medium px-4 py-2.5">Paid</th>
              <th className="text-left font-medium px-4 py-2.5">Expected</th>
              <th className="text-left font-medium px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-300">
            {sorted.map((po) => {
              const status = derivePOStatus(po);
              return (
                <tr key={po.id} className="hover:bg-ink-100/50">
                  <td className="px-4 py-3 font-medium text-ink-900">
                    {po.supplier_name ?? "—"}
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
                    {po.actual_delivery_date ? (
                      <span>
                        {fmtDate(po.actual_delivery_date)}
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
                      {STATUS_LABEL[status]}
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
