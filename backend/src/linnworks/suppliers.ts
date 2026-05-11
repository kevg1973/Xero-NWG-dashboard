import { linnworksRequest } from "./client.js";
import { supabase } from "../db/supabase.js";

/**
 * Inventory/GetSuppliers returns a plain JSON array (not a paged envelope).
 * Empty body is accepted; the endpoint returns every supplier the application
 * can see. Verified live 2026-05-11.
 */
export type LinnworksSupplier = {
  pkSupplierID: string;
  SupplierName: string;
  [key: string]: unknown;
};

type SupplierRow = {
  linnworks_supplier_id: string;
  supplier_name: string;
};

export type SupplierSyncSummary = {
  fetched: number;
  upserted: number;
};

export async function fetchAllSuppliers(): Promise<LinnworksSupplier[]> {
  const result = await linnworksRequest<LinnworksSupplier[]>("Inventory/GetSuppliers");
  return Array.isArray(result) ? result : [];
}

/**
 * Pulls every supplier from Linnworks and upserts into the suppliers table.
 * Returns a UUID→name Map for the caller to use when writing PO rows.
 */
export async function syncSuppliers(): Promise<{
  summary: SupplierSyncSummary;
  byId: Map<string, string>;
}> {
  const suppliers = await fetchAllSuppliers();

  const rows: SupplierRow[] = suppliers
    .filter((s) => s.pkSupplierID && s.SupplierName)
    .map((s) => ({
      linnworks_supplier_id: s.pkSupplierID,
      supplier_name: s.SupplierName,
    }));

  if (rows.length) {
    const { error } = await supabase
      .from("suppliers")
      .upsert(rows, { onConflict: "linnworks_supplier_id", ignoreDuplicates: false });
    if (error) {
      throw new Error(`suppliers upsert failed: ${error.message ?? "(no message)"}`);
    }
  }

  const byId = new Map(rows.map((r) => [r.linnworks_supplier_id, r.supplier_name]));

  return {
    summary: { fetched: suppliers.length, upserted: rows.length },
    byId,
  };
}
