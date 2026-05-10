import { supabase } from "../db/supabase.js";
import { searchAllPurchaseOrders, type LinnworksPOHeader } from "./purchaseOrders.js";

type PORow = {
  linnworks_po_id: string;
  po_number: string | null;
  supplier_name: string | null;
  po_date: string | null;
  currency: string | null;
  po_value_original: number | null;
  po_value_gbp: number | null;
  expected_delivery_date: string | null;
  linnworks_status: string | null;
  last_synced_at: string;
};

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
  const totalCost = num(h.TotalCost);
  const conversion = num(h.ConversionRate);
  const currency = (h.Currency ?? "").toUpperCase() || null;

  /**
   * Linnworks PO totals appear to be in supplier currency. ConversionRate (when
   * present) is supplier→GBP. If currency is GBP, original == GBP.
   * If we have a rate, derive GBP. Otherwise leave po_value_gbp null and let
   * the dashboard either show "-" or fall back to original. Revisit FX strategy
   * in Phase 2 once we have real data to inspect.
   */
  let valueGbp: number | null = null;
  if (totalCost !== null) {
    if (currency === "GBP" || currency === null) valueGbp = totalCost;
    else if (conversion !== null && conversion > 0) valueGbp = totalCost / conversion;
  }

  return {
    linnworks_po_id: h.pkPurchaseId,
    po_number: (h.ExternalInvoiceNumber as string | null) ?? null,
    supplier_name: (h.Supplier as string | null) ?? null,
    po_date: toDateOnly(h.DateOfPurchase),
    currency,
    po_value_original: totalCost,
    po_value_gbp: valueGbp,
    expected_delivery_date: toDateOnly(h.QuotedDeliveryDate ?? h.DateOfDelivery),
    linnworks_status: (h.Status as string | null) ?? null,
    last_synced_at: syncedAt,
  };
}

export type SyncSummary = {
  fetched: number;
  upserted: number;
  fromDate: string;
  toDate: string;
  durationMs: number;
};

export type SyncMode = "incremental" | "full";

export async function syncPurchaseOrders(mode: SyncMode = "incremental"): Promise<SyncSummary> {
  const startedAt = Date.now();
  const now = new Date();
  const from = new Date(now);
  if (mode === "incremental") {
    from.setHours(from.getHours() - 36);
  } else {
    from.setFullYear(from.getFullYear() - 2);
  }

  const headers = await searchAllPurchaseOrders({ fromDate: from, toDate: now });
  const syncedAt = new Date().toISOString();
  const rows = headers.map((h) => mapHeader(h, syncedAt));

  /**
   * Idempotency: only update Linnworks-owned columns. User-edit columns
   * (payment_terms, deposit_*, balance_*, actual_delivery_date, notes) are
   * NEVER touched by sync. We achieve this by listing only Linnworks columns
   * in the upsert payload — Postgres leaves untouched columns alone.
   */
  let upserted = 0;
  if (rows.length) {
    const { error, count } = await supabase
      .from("purchase_orders")
      .upsert(rows, { onConflict: "linnworks_po_id", count: "exact" });
    if (error) throw new Error(`purchase_orders upsert failed: ${error.message}`);
    upserted = count ?? rows.length;
  }

  return {
    fetched: headers.length,
    upserted,
    fromDate: from.toISOString(),
    toDate: now.toISOString(),
    durationMs: Date.now() - startedAt,
  };
}
