import { linnworksRequest } from "./client.js";
import { supabase } from "../db/supabase.js";
import { env } from "../env.js";

/**
 * Dashboards/GetFinancialSummary response shape (verified live 2026-05-11).
 *
 * Top-level: { Purchases: [], Negatives: [], Sales: [], Stock: {} }
 *
 * Purchases, Negatives, Sales are each arrays with one entry per currency
 * (GBP, AUD, EUR, USD, Unknown, Combined). We pick the GBP entry (the
 * default currency for NWG) for the scalar columns.
 *
 * Why not "Combined": Linnworks computes a Combined rollup but it's polluted
 * by the "Unknown" currency bucket — POs in Linnworks that lack a proper
 * currency tag get lumped into Unknown with garbage values (observed
 * 9.89M in a 90d window for an ~£80k/quarter business). The GBP entry is
 * stable; foreign-currency rollup can be reconstructed from raw_response if
 * we ever need it.
 *
 * Stock is a single object with Begin/End and 5 movement categories
 * (Shipped, Scrapped, Returned, Added, Adjusted), each with a daily-detail
 * array we don't currently use.
 */

type Currency = {
  Code: string;
  IsDefault: boolean;
  ConversionRate: number;
};

type PurchasesEntry = {
  Currency: Currency;
  TotalCost: number;
  Tax: number;
  ShippingExTax: number;
  Returned: number;
  PurchasesList?: unknown[];
};

type NegativesEntry = {
  Currency: Currency;
  RefundsTotal: number;
  RefundsTotalOrderItem: number;
  Refunds?: unknown[];
  RefundsOrderItem?: unknown[];
};

type SalesEntry = {
  Currency: Currency;
  Total: number;
  TotalCharge: number;
  Tax: number;
  ShippingExTax: number;
  SalesList?: unknown[];
};

type StockBlock = {
  Begin: number;
  End: number;
  Shipped: number;
  Scrapped: number;
  Returned: number;
  Added: number;
  Adjusted: number;
};

export type FinancialSummaryResponse = {
  Purchases: PurchasesEntry[];
  Negatives: NegativesEntry[];
  Sales: SalesEntry[];
  Stock: StockBlock;
};

export type PeriodType = "mtd" | "trailing_90d";

type Period = {
  type: PeriodType;
  start: Date;
  end: Date;
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function isoDate(d: Date): string {
  // YYYY-MM-DD in local time. Used for date columns and snapshot_date.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildPeriods(now: Date = new Date()): Period[] {
  const today = startOfDay(now);
  const mtdStart = startOfMonth(today);

  const trailingStart = new Date(today);
  trailingStart.setDate(trailingStart.getDate() - 90);

  return [
    { type: "mtd", start: mtdStart, end: today },
    { type: "trailing_90d", start: trailingStart, end: today },
  ];
}

export async function fetchFinancialSummary(start: Date, end: Date): Promise<FinancialSummaryResponse> {
  /**
   * UTCOffSet=1 matches the UK (BST). The endpoint uses ISO datetimes; we
   * pass start at 00:00 and end as "now" so MTD includes today's activity.
   */
  return linnworksRequest<FinancialSummaryResponse>("Dashboards/GetFinancialSummary", {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    UTCOffSet: 1,
  });
}

function pickDefault<T extends { Currency: Currency }>(entries: T[]): T | undefined {
  // NWG's default currency is GBP. Match by Code first, fall back to IsDefault.
  return (
    entries.find((e) => e.Currency?.Code === "GBP") ??
    entries.find((e) => e.Currency?.IsDefault === true)
  );
}

export type FinancialSyncSummary = {
  snapshots: Array<{
    period_type: PeriodType;
    period_start: string;
    period_end: string;
    sales_total: number | null;
    refunds_total: number | null;
    purchases_total: number | null;
  }>;
  upserted: number;
};

export async function syncFinancialSnapshots(now: Date = new Date()): Promise<FinancialSyncSummary> {
  const periods = buildPeriods(now);
  const snapshotDate = isoDate(startOfDay(now));

  const rows: Array<{
    snapshot_date: string;
    period_type: PeriodType;
    period_start: string;
    period_end: string;
    sales_total: number | null;
    refunds_total: number | null;
    purchases_total: number | null;
    stock_begin: number | null;
    stock_shipped: number | null;
    stock_scrapped: number | null;
    stock_returned: number | null;
    stock_added: number | null;
    raw_response: FinancialSummaryResponse;
  }> = [];

  for (const period of periods) {
    const response = await fetchFinancialSummary(period.start, period.end);

    if (env.LINNWORKS_DEBUG) {
      const purchases = response.Purchases?.map((p) => `${p.Currency.Code}=${p.TotalCost}`).join(", ");
      console.log(`[financial] ${period.type} purchases by currency: ${purchases}`);
    }

    const purchasesEntry = pickDefault(response.Purchases ?? []);
    const salesEntry = pickDefault(response.Sales ?? []);
    const refundsEntry = pickDefault(response.Negatives ?? []);
    const stock = response.Stock;

    const refundsTotal =
      refundsEntry == null
        ? null
        : (refundsEntry.RefundsTotal ?? 0) + (refundsEntry.RefundsTotalOrderItem ?? 0);

    rows.push({
      snapshot_date: snapshotDate,
      period_type: period.type,
      period_start: isoDate(period.start),
      period_end: isoDate(period.end),
      sales_total: salesEntry?.Total ?? null,
      refunds_total: refundsTotal,
      purchases_total: purchasesEntry?.TotalCost ?? null,
      stock_begin: stock?.Begin ?? null,
      stock_shipped: stock?.Shipped ?? null,
      stock_scrapped: stock?.Scrapped ?? null,
      stock_returned: stock?.Returned ?? null,
      stock_added: stock?.Added ?? null,
      raw_response: response,
    });
  }

  const { error } = await supabase
    .from("linnworks_financial_snapshots")
    .upsert(rows, { onConflict: "snapshot_date,period_type", ignoreDuplicates: false });

  if (error) {
    throw new Error(`linnworks_financial_snapshots upsert failed: ${error.message ?? "(no message)"}`);
  }

  return {
    snapshots: rows.map((r) => ({
      period_type: r.period_type,
      period_start: r.period_start,
      period_end: r.period_end,
      sales_total: r.sales_total,
      refunds_total: r.refunds_total,
      purchases_total: r.purchases_total,
    })),
    upserted: rows.length,
  };
}
