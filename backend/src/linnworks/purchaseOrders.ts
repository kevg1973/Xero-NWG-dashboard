import { linnworksRequest } from "./client.js";

/**
 * Search_PurchaseOrders is technically marked deprecated in apidocs but is still
 * the operational paged-listing endpoint. No documented replacement as of 2026-05.
 * Keep an eye on Linnworks changelog; if a v2 lands, swap it here.
 */

export type LinnworksPOHeader = {
  pkPurchaseId: string;
  ExternalInvoiceNumber?: string | null;
  Supplier?: string | null;
  SupplierId?: string | null;
  DateOfPurchase?: string | null;
  DateOfDelivery?: string | null;
  QuotedDeliveryDate?: string | null;
  Currency?: string | null;
  ConversionRate?: number | null;
  TotalCost?: number | null;
  SubTotal?: number | null;
  PostageAndPacking?: number | null;
  TaxValue?: number | null;
  Status?: string | null;
  NumberOfLines?: number | null;
  [key: string]: unknown;
};

type SearchResult = {
  Data: LinnworksPOHeader[];
  TotalEntries: number;
  TotalPages: number;
  EntriesPerPage: number;
  PageNumber: number;
};

type SearchOpts = {
  fromDate?: Date;
  toDate?: Date;
  status?: string;
  pageNumber?: number;
  entriesPerPage?: number;
};

function toIso(date: Date | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

export async function searchPurchaseOrdersPage(opts: SearchOpts): Promise<SearchResult> {
  const searchParameter = {
    DateField: opts.fromDate || opts.toDate ? "DATE_OF_PURCHASE" : null,
    FromDate: toIso(opts.fromDate),
    ToDate: toIso(opts.toDate),
    SearchField: opts.status ? "Status" : null,
    ExactMatch: !!opts.status,
    SearchTerm: opts.status ?? null,
    PageNumber: opts.pageNumber ?? 1,
    EntriesPerPage: opts.entriesPerPage ?? 200,
  };

  return linnworksRequest<SearchResult>("PurchaseOrder/Search_PurchaseOrders", {
    searchParameter,
  });
}

export async function searchAllPurchaseOrders(opts: SearchOpts): Promise<LinnworksPOHeader[]> {
  const all: LinnworksPOHeader[] = [];
  let page = 1;
  while (true) {
    const result = await searchPurchaseOrdersPage({ ...opts, pageNumber: page });
    if (!result?.Data?.length) break;
    all.push(...result.Data);
    if (page >= (result.TotalPages ?? 1)) break;
    page += 1;
  }
  return all;
}

export async function getPurchaseOrder(pkPurchaseId: string): Promise<LinnworksPOHeader> {
  return linnworksRequest<LinnworksPOHeader>("PurchaseOrder/Get_PurchaseOrder", {
    pkPurchaseId,
  });
}
