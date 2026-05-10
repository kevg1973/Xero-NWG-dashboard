import { linnworksRequest } from "./client.js";
import { env } from "../env.js";

/**
 * Use Search_PurchaseOrders2 — the v2 endpoint with cleaner params (DateFrom/
 * DateTo as plain dates, no DateField enum), built-in PO-date sort, and proper
 * Status enum. The original Search_PurchaseOrders is deprecated.
 */

/**
 * Field names per Search_PurchaseOrders2 live response (verified 2026-05-10).
 * Note: pkPurchaseID has a capital ID (not pkPurchaseId).
 * Note: fkSupplierId is a UUID; the name has to be resolved separately.
 */
export type LinnworksPOHeader = {
  pkPurchaseID: string;
  ExternalInvoiceNumber?: string | null;
  fkSupplierId?: string | null;
  DateOfPurchase?: string | null;
  DateOfDelivery?: string | null;
  QuotedDeliveryDate?: string | null;
  Currency?: string | null;
  TotalCost?: number | null;
  ConvertedGrandTotal?: number | null;
  Status?: string | null;
  LineCount?: number | null;
  DeliveredLinesCount?: number | null;
  [key: string]: unknown;
};

/**
 * Linnworks pages this endpoint as `GenericPagedResult<T>`. The result array
 * lives under `Result` (not `Data` — that name is reserved for other paged
 * endpoints, e.g. SearchProcessedOrders). Confirmed against live response
 * 2026-05-10.
 */
type SearchResult = {
  Result?: LinnworksPOHeader[];
  TotalEntries?: number;
  TotalPages?: number;
  EntriesPerPage?: number;
  PageNumber?: number;
  [key: string]: unknown;
};

export type POStatus = "PENDING" | "OPEN" | "PARTIAL" | "DELIVERED";

type SearchOpts = {
  fromDate?: Date;
  toDate?: Date;
  status?: POStatus;
  pageNumber?: number;
  entriesPerPage?: number;
};

function toIso(date: Date | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

function compactObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<T>;
}

export async function searchPurchaseOrdersPage(opts: SearchOpts): Promise<SearchResult> {
  const request = compactObject({
    DateFrom: toIso(opts.fromDate),
    DateTo: toIso(opts.toDate),
    Status: opts.status,
    SearchType: "All",
    PageNumber: opts.pageNumber ?? 1,
    EntriesPerPage: opts.entriesPerPage ?? 200,
  });

  return linnworksRequest<SearchResult>("PurchaseOrder/Search_PurchaseOrders2", {
    request,
  });
}

export async function searchAllPurchaseOrders(opts: SearchOpts): Promise<LinnworksPOHeader[]> {
  const all: LinnworksPOHeader[] = [];
  let page = 1;
  while (true) {
    const result = await searchPurchaseOrdersPage({ ...opts, pageNumber: page });
    const data = result?.Result ?? [];

    if (env.LINNWORKS_DEBUG) {
      console.log(
        `[linnworks] page ${page}: returned ${data.length} POs, TotalEntries=${result?.TotalEntries}, TotalPages=${result?.TotalPages}`,
      );
      if (data.length && page === 1) {
        console.log("[linnworks] first PO header keys:", Object.keys(data[0]));
        console.log("[linnworks] first PO header sample:", JSON.stringify(data[0], null, 2));
      }
    }

    if (!data.length) break;
    all.push(...data);
    if (page >= (result?.TotalPages ?? 1)) break;
    page += 1;
  }
  return all;
}

export async function getPurchaseOrder(pkPurchaseId: string): Promise<LinnworksPOHeader> {
  return linnworksRequest<LinnworksPOHeader>("PurchaseOrder/Get_PurchaseOrder", {
    pkPurchaseId,
  });
}
