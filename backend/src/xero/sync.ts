import { supabase } from "../db/supabase.js";
import { fetchProfitAndLoss, fetchBalanceSheet, fetchBankSummary } from "./reports.js";

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

export async function syncXeroSnapshots(now: Date = new Date()): Promise<XeroSyncSummary> {
  const today = startOfDay(now);
  const mtdStart = startOfMonth(today);
  const trailingStart = new Date(today);
  trailingStart.setDate(trailingStart.getDate() - 90);

  const snapshotDate = isoDate(today);

  // P&L MTD
  const mtdPnl = await fetchProfitAndLoss(mtdStart, today);
  // P&L trailing 90d
  const trailingPnl = await fetchProfitAndLoss(trailingStart, today);
  // Balance sheet provides AR/AP. Cash comes from BankSummary instead,
  // because BalanceSheet rounds `date` to month-end while BankSummary honours
  // arbitrary dates — important when comparing day-by-day snapshots across
  // month boundaries.
  const balance = await fetchBalanceSheet(today);
  const bankSummary = await fetchBankSummary(today);

  const rows = [
    {
      snapshot_date: snapshotDate,
      period_type: "mtd" as XeroPeriodType,
      period_start: isoDate(mtdStart),
      period_end: isoDate(today),
      revenue: mtdPnl.revenue,
      cogs: mtdPnl.cogs,
      gross_profit: mtdPnl.gross_profit,
      operating_expenses: mtdPnl.operating_expenses,
      cash_total: null as number | null,
      trade_receivables: null as number | null,
      trade_payables: null as number | null,
      raw_response: mtdPnl.raw,
    },
    {
      snapshot_date: snapshotDate,
      period_type: "trailing_90d" as XeroPeriodType,
      period_start: isoDate(trailingStart),
      period_end: isoDate(today),
      revenue: trailingPnl.revenue,
      cogs: trailingPnl.cogs,
      gross_profit: trailingPnl.gross_profit,
      operating_expenses: trailingPnl.operating_expenses,
      cash_total: null,
      trade_receivables: null,
      trade_payables: null,
      raw_response: trailingPnl.raw,
    },
    {
      snapshot_date: snapshotDate,
      period_type: "balance_sheet" as XeroPeriodType,
      period_start: null as string | null,
      period_end: isoDate(today),
      revenue: null,
      cogs: null,
      gross_profit: null,
      operating_expenses: null,
      cash_total: bankSummary.cash_total,
      trade_receivables: balance.trade_receivables,
      trade_payables: balance.trade_payables,
      raw_response: { balance_sheet: balance.raw, bank_summary: bankSummary.raw },
    },
  ];

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
      trade_receivables: r.trade_receivables,
      trade_payables: r.trade_payables,
    })),
    upserted: rows.length,
  };
}
