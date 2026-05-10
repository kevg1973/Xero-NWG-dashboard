import { useState } from "react";
import { supabase } from "../lib/supabase";
import type { PurchaseOrder } from "../lib/types";

type EditableFields = {
  payment_terms: string;
  deposit_amount: string;
  deposit_date: string;
  balance_amount: string;
  balance_date: string;
  actual_delivery_date: string;
  notes: string;
};

function toForm(po: PurchaseOrder): EditableFields {
  return {
    payment_terms: po.payment_terms ?? "",
    deposit_amount: po.deposit_amount?.toString() ?? "",
    deposit_date: po.deposit_date ?? "",
    balance_amount: po.balance_amount?.toString() ?? "",
    balance_date: po.balance_date ?? "",
    actual_delivery_date: po.actual_delivery_date ?? "",
    notes: po.notes ?? "",
  };
}

function toDb(f: EditableFields) {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const str = (v: string) => (v.trim() === "" ? null : v);
  return {
    payment_terms: str(f.payment_terms),
    deposit_amount: num(f.deposit_amount),
    deposit_date: str(f.deposit_date),
    balance_amount: num(f.balance_amount),
    balance_date: str(f.balance_date),
    actual_delivery_date: str(f.actual_delivery_date),
    notes: str(f.notes),
  };
}

export function POEditPanel({
  po,
  onClose,
  onSaved,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditableFields>(toForm(po));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof EditableFields>(k: K, v: string) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("purchase_orders")
      .update(toDb(form))
      .eq("id", po.id);
    setSaving(false);
    if (error) setError(error.message);
    else onSaved();
  }

  return (
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center px-4 z-50">
      <div className="bg-white rounded-lg max-w-lg w-full p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold">{po.supplier_name ?? "Purchase order"}</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            {po.po_number ?? po.linnworks_po_id}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Payment terms">
            <input
              type="text"
              placeholder="e.g. 50% deposit, 50% on shipping"
              value={form.payment_terms}
              onChange={(e) => update("payment_terms", e.target.value)}
              className="w-full border border-ink-300 rounded px-2 py-1.5 text-sm col-span-2"
            />
          </Field>

          <Field label="Deposit amount (GBP)">
            <input
              type="number"
              step="0.01"
              value={form.deposit_amount}
              onChange={(e) => update("deposit_amount", e.target.value)}
              className="w-full border border-ink-300 rounded px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Deposit date">
            <input
              type="date"
              value={form.deposit_date}
              onChange={(e) => update("deposit_date", e.target.value)}
              className="w-full border border-ink-300 rounded px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Balance amount (GBP)">
            <input
              type="number"
              step="0.01"
              value={form.balance_amount}
              onChange={(e) => update("balance_amount", e.target.value)}
              className="w-full border border-ink-300 rounded px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Balance date">
            <input
              type="date"
              value={form.balance_date}
              onChange={(e) => update("balance_date", e.target.value)}
              className="w-full border border-ink-300 rounded px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Actual delivery date">
            <input
              type="date"
              value={form.actual_delivery_date}
              onChange={(e) => update("actual_delivery_date", e.target.value)}
              className="w-full border border-ink-300 rounded px-2 py-1.5 text-sm col-span-2"
            />
          </Field>
        </div>

        <div>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Notes</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              className="mt-1 w-full border border-ink-300 rounded px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        {error && (
          <div className="text-sm text-bad bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="text-sm text-ink-500 hover:text-ink-900 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-ink-900 text-white text-sm font-medium rounded px-3 py-1.5 hover:bg-ink-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
