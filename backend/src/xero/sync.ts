import { supabase } from "../db/supabase.js";
import { fetchProfitAndLoss, fetchBalanceSheet, fetchBankSummary, fetchAccountTypes } from "./reports.js";

export type XeroPeriodType = "mtd" | "trailing_90d" | "balance_sheet";

export type XeroSyncSummary = {
  snapshots: Array<{
    period_type: XeroPeriodType;
    period_start: string | null;
    period_end: string;
    revenue: number | null;
    cogs: number | null;
    gross_profit: number | null;
    operating_expenses: number | null;
    cash_total: number | null;
    credit_card_liability: number | null;
    trade_receivables: number | null;
    trade_payables: number | null;
  }>;
  upserted: number;
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type XeroSnapshotRow = {
  snapshot_date: string;
  period_type: XeroPeriodType;
  period_start: string | null;
  period_end: string;
  revenue: number | null;
  cogs: number | null;
  gross_profit: number | null;
  operating_expenses: number | null;
  cash_total: number | null;
  credit_card_liability: number | null;
  trade_receivables: number | null;
  trade_payables: number | null;
  raw_response: unknown;
};

export type SyncXeroOptions = {
  /**
   * Pre-fetched accountID → BankAccountType map. Pass this in bulk runs
   * (the backfill) so GET /Accounts is called once, not per date. Only
   * used when includeBalanceSheet is true.
   */
  accountTypes?: Map<string, string>;
  /**
   * Whether to fetch + write the balance_sheet row (BalanceSheet for AR/AP,
   * BankSummary for cash/credit-card). Default true. The backfill sets this
   * false for non-month-end dates: BalanceSheet rounds `date` to month-end,
   * so a balance_sheet row for a mid-month historical date would carry that
   * month's month-end AR/AP — a value that's in the future relative to the
   * snapshot date. Backfill therefore only writes balance_sheet on month-end
   * dates, where the rounding is a no-op and the value is genuine.
   */
  includeBalanceSheet?: boolean;
};

export async function syncXeroSnapshots(
  now: Date = new Date(),
  opts: SyncXeroOptions = {},
): Promise<XeroSyncSummary> {
  const includeBalanceSheet = opts.includeBalanceSheet ?? true;
  const today = startOfDay(now);
  const mtdStart = startOfMonth(today);
  const trailingStart = new Date(today);
  trailingStart.setDate(trailingStart.getDate() - 90);

  const snapshotDate = isoDate(today);

  const mtdPnl = await fetchProfitAndLoss(mtdStart, today);
  const trailingPnl = await fetchProfitAndLoss(trailingStart, today);

  const rows: XeroSnapshotRow[] = [
    {
      snapshot_date: snapshotDate,
      period_type: "mtd",
      period_start: isoDate(mtdStart),
      period_end: isoDate(today),
      revenue: mtdPnl.revenue,
      cogs: mtdPnl.cogs,
      gross_profit: mtdPnl.gross_profit,
      operating_expenses: mtdPnl.operating_expenses,
      cash_total: null,
      credit_card_liability: null,
      trade_receivables: null,
      trade_payables: null,
      raw_response: mtdPnl.raw,
    },
    {
      snapshot_date: snapshotDate,
      period_type: "trailing_90d",
      period_start: isoDate(trailingStart),
      period_end: isoDate(today),
      revenue: trailingPnl.revenue,
      cogs: trailingPnl.cogs,
      gross_profit: trailingPnl.gross_profit,
      operating_expenses: trailingPnl.operating_expenses,
      cash_total: null,
      credit_card_liability: null,
      trade_receivables: null,
      trade_payables: null,
      raw_response: trailingPnl.raw,
    },
  ];

  if (includeBalanceSheet) {
    const balance = await fetchBalanceSheet(today);
    const accountTypes = opts.accountTypes ?? (await fetchAccountTypes());
    const bankSummary = await fetchBankSummary(today, accountTypes);
    rows.push({
      snapshot_date: snapshotDate,
      period_type: "balance_sheet",
      period_start: null,
      period_end: isoDate(today),
      revenue: null,
      cogs: null,
      gross_profit: null,
      operating_expenses: null,
      cash_total: bankSummary.cash_total,
      credit_card_liability: bankSummary.credit_card_liability,
      trade_receivables: balance.trade_receivables,
      trade_payables: balance.trade_payables,
      raw_response: { balance_sheet: balance.raw, bank_summary: bankSummary.raw },
    });
  }

  const { error } = await supabase
    .from("xero_snapshots")
    .upsert(rows, { onConflict: "snapshot_date,period_type", ignoreDuplicates: false });

  if (error) {
    throw new Error(`xero_snapshots upsert failed: ${error.message ?? "(no message)"}`);
  }

  return {
    snapshots: rows.map((r) => ({
      period_type: r.period_type,
      period_start: r.period_start,
      period_end: r.period_end,
      revenue: r.revenue,
      cogs: r.cogs,
      gross_profit: r.gross_profit,
      operating_expenses: r.operating_expenses,
      cash_total: r.cash_total,
      credit_card_liability: r.credit_card_liability,
      trade_receivables: r.trade_receivables,
      trade_payables: r.trade_payables,
    })),
    upserted: rows.length,
  };
}
