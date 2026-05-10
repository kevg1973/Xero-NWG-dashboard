import { supabase } from "../db/supabase.js";
import { searchAllPurchaseOrders, type LinnworksPOHeader } from "./purchaseOrders.js";

type PORow = {
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
  last_synced_at: string;
};

const COMPARE_KEYS: Array<keyof PORow> = [
  "po_number",
  "po_date",
  "currency",
  "po_value_original",
  "po_value_gbp",
  "expected_delivery_date",
  "delivery_date",
  "linnworks_status",
  "linnworks_supplier_id",
  "line_count",
  "delivered_lines_count",
];

function toDateOnly(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function mapHeader(h: LinnworksPOHeader, syncedAt: string): PORow {
  return {
    linnworks_po_id: h.pkPurchaseID,
    linnworks_supplier_id: h.fkSupplierId ?? null,
    po_number: h.ExternalInvoiceNumber ?? null,
    supplier_name: null, // resolved in Phase 2 via supplier-name lookup
    po_date: toDateOnly(h.DateOfPurchase),
    currency: (h.Currency ?? "").toUpperCase() || null,
    po_value_original: num(h.TotalCost),
    po_value_gbp: num(h.ConvertedGrandTotal),
    expected_delivery_date: toDateOnly(h.QuotedDeliveryDate),
    delivery_date: toDateOnly(h.DateOfDelivery),
    linnworks_status: h.Status ?? null,
    line_count: num(h.LineCount),
    delivered_lines_count: num(h.DeliveredLinesCount),
    last_synced_at: syncedAt,
  };
}

function rowsDiffer(prev: Partial<PORow>, next: PORow): boolean {
  return COMPARE_KEYS.some((k) => {
    const a = prev[k];
    const b = next[k];
    if (a == null && b == null) return false;
    if (a == null || b == null) return true;
    return String(a) !== String(b);
  });
}

/**
 * Supabase JS errors are PostgrestError-shaped: { message, code, details, hint }.
 * `message` is sometimes empty (e.g. when nginx returns 414/413 with no body),
 * so always include the other fields if present.
 */
function formatPgError(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const err = e as { code?: string; message?: string; details?: string; hint?: string };
  const parts = [
    err.code ? `[${err.code}]` : null,
    err.message || null,
    err.details ? `details=${err.details}` : null,
    err.hint ? `hint=${err.hint}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "(no error body)";
}

export type SyncSummary = {
  fetched: number;
  inserts: number;
  updates: number;
  unchanged: number;
  durationMs: number;
};

export type SyncMode = "incremental" | "full";

/**
 * Rolling 12-month window. Linnworks holds ~3000 POs of history; pulling all
 * of them is feasible but wasteful. Tradeoff accepted: if Linnworks edits a
 * status/value on a 13+ month-old PO it won't propagate until a manual full
 * sync. Both modes currently do the same thing — kept as separate functions
 * to allow future divergence (e.g. incremental could narrow further).
 */
export async function syncPurchaseOrders(_mode: SyncMode = "incremental"): Promise<SyncSummary> {
  const startedAt = Date.now();

  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 12);
  const headers = await searchAllPurchaseOrders({ fromDate });
  const syncedAt = new Date().toISOString();
  const rows = headers.map((h) => mapHeader(h, syncedAt));

  if (!rows.length) {
    return { fetched: 0, inserts: 0, updates: 0, unchanged: 0, durationMs: Date.now() - startedAt };
  }

  /**
   * Diagnostic: count inserts vs updates vs unchanged. Read all existing
   * Linnworks-owned columns and look up incoming rows in a Map. We deliberately
   * do NOT pass an .in() filter here — PostgREST puts that list in the URL,
   * which fails with 414 once the row count grows past ~200 GUIDs (and 414s
   * come back with no body, so the JS client surfaces an empty error message).
   * The table is ~3000 rows × 12 thin columns; a full select is still cheap.
   */
  const { data: existing, error: selError } = await supabase
    .from("purchase_orders")
    .select(
      "linnworks_po_id, po_number, po_date, currency, po_value_original, po_value_gbp, expected_delivery_date, delivery_date, linnworks_status, linnworks_supplier_id, line_count, delivered_lines_count",
    );
  if (selError) {
    console.error("[sync] pre-upsert select error:", selError);
    throw new Error(`pre-upsert select failed: ${formatPgError(selError)}`);
  }

  const existingMap = new Map((existing ?? []).map((r) => [r.linnworks_po_id, r]));

  let inserts = 0;
  let updates = 0;
  let unchanged = 0;
  for (const row of rows) {
    const prev = existingMap.get(row.linnworks_po_id);
    if (!prev) inserts++;
    else if (rowsDiffer(prev as Partial<PORow>, row)) updates++;
    else unchanged++;
  }

  /**
   * Idempotency: only update Linnworks-owned columns. User-edit columns
   * (payment_*, deposit_*, balance_*, notes) are NEVER touched by sync. We
   * achieve this by listing only Linnworks columns in the upsert payload —
   * Postgres leaves untouched columns alone on UPDATE.
   */
  const { error } = await supabase
    .from("purchase_orders")
    .upsert(rows, { onConflict: "linnworks_po_id", ignoreDuplicates: false });
  if (error) {
    console.error("[sync] purchase_orders upsert error:", error);
    throw new Error(`purchase_orders upsert failed: ${formatPgError(error)}`);
  }

  return {
    fetched: headers.length,
    inserts,
    updates,
    unchanged,
    durationMs: Date.now() - startedAt,
  };
}
