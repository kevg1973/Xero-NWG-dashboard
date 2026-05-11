import { xeroGet } from "./client.js";

/**
 * Xero report payloads use a nested rows-of-rows structure with RowType
 * discriminators (Header, Section, Row, SummaryRow). We don't try to model
 * the full tree — we just flatten it and pick the cells we want by label
 * matching. Anything we miss stays in raw_response.
 */

export type XeroCell = { Value?: string; Attributes?: Array<{ Id: string; Value: string }> };
export type XeroRow = {
  RowType: "Header" | "Section" | "Row" | "SummaryRow";
  Title?: string;
  Cells?: XeroCell[];
  Rows?: XeroRow[];
};

export type XeroReportEnvelope<TReport = unknown> = {
  Id: string;
  Status: string;
  Reports: TReport[];
};

export type XeroReport = {
  ReportID: string;
  ReportName: string;
  ReportType: string;
  Rows: XeroRow[];
};

function flatten(rows: XeroRow[] | undefined, out: XeroRow[] = []): XeroRow[] {
  if (!rows) return out;
  for (const r of rows) {
    out.push(r);
    if (r.Rows?.length) flatten(r.Rows, out);
  }
  return out;
}

function parseAmount(cell: XeroCell | undefined): number | null {
  const raw = cell?.Value;
  if (raw == null || raw === "") return null;
  // Xero formats negatives as "-123.45" or "(123.45)" depending on context.
  const cleaned = raw.replace(/[(),]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const negParen = /\(.*\)/.test(raw);
  return negParen ? -Math.abs(n) : n;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * For P&L: scan all Row/SummaryRow entries; match by Cell[0].Value against
 * known label patterns. Picks the LAST match for each metric so subtotals
 * inside Sections don't override the top-level "Total Income" / "Total
 * Operating Expenses" summary rows that appear later in the tree.
 */
function findAmountByLabel(rows: XeroRow[], patterns: RegExp[]): number | null {
  const flat = flatten(rows);
  let last: number | null = null;
  for (const row of flat) {
    if (row.RowType !== "Row" && row.RowType !== "SummaryRow") continue;
    const label = row.Cells?.[0]?.Value ?? "";
    if (patterns.some((p) => p.test(label))) {
      const value = parseAmount(row.Cells?.[1]);
      if (value != null) last = value;
    }
  }
  return last;
}

export type ProfitAndLossResult = {
  raw: XeroReportEnvelope;
  revenue: number | null;
  cogs: number | null;
  gross_profit: number | null;
  operating_expenses: number | null;
};

export async function fetchProfitAndLoss(fromDate: Date, toDate: Date): Promise<ProfitAndLossResult> {
  const raw = await xeroGet<XeroReportEnvelope<XeroReport>>("/Reports/ProfitAndLoss", {
    fromDate: isoDate(fromDate),
    toDate: isoDate(toDate),
  });
  const report = raw.Reports?.[0];
  const rows = report?.Rows ?? [];

  // "Total Income" / "Total Revenue" — different Xero org configs use different labels.
  const revenue = findAmountByLabel(rows, [/^Total Income$/i, /^Total Revenue$/i, /^Total Operating Income$/i]);
  // Xero's "Cost of Sales" section: Purchases, Direct Wages, etc. For NWG this
  // is "Purchases + Direct Wages expensed in the period", not stock-shipped
  // COGS — the accountant will reconcile via stock-on-hand journals later.
  const cogs = findAmountByLabel(rows, [/^Total Cost of Sales$/i, /^Total Cost of Goods Sold$/i]);
  // Trust Xero's own Gross Profit summary row rather than computing revenue-cogs —
  // keeps the dashboard consistent with Xero even if the report adds rows we
  // don't model (e.g. other income above gross profit).
  const gross_profit = findAmountByLabel(rows, [/^Gross Profit$/i]);
  // "Total Operating Expenses" / "Total Expenses".
  const operating_expenses = findAmountByLabel(rows, [/^Total Operating Expenses$/i, /^Total Expenses$/i]);

  return { raw, revenue, cogs, gross_profit, operating_expenses };
}

export type BalanceSheetResult = {
  raw: XeroReportEnvelope;
  cash_total: number | null;
  trade_receivables: number | null;
  trade_payables: number | null;
};

/**
 * Balance sheet parsing is fuzzier than P&L:
 *  - "Total Bank" or sum of all rows under the "Bank" section → cash_total.
 *    Includes whatever bank/PayPal/Stripe accounts Xero has classified as Bank.
 *  - "Accounts Receivable" / "Trade Debtors" / "Total Current Assets" subrow → trade_receivables.
 *  - "Accounts Payable" / "Trade Creditors" → trade_payables.
 */
export async function fetchBalanceSheet(asOf: Date): Promise<BalanceSheetResult> {
  const raw = await xeroGet<XeroReportEnvelope<XeroReport>>("/Reports/BalanceSheet", {
    date: isoDate(asOf),
  });
  const report = raw.Reports?.[0];
  const rows = report?.Rows ?? [];

  const cash_total =
    findAmountByLabel(rows, [/^Total Bank$/i]) ??
    sumBankSection(rows);

  const trade_receivables = findAmountByLabel(rows, [
    /^Accounts Receivable$/i,
    /^Trade Debtors$/i,
    /^Trade Receivables$/i,
  ]);

  const trade_payables = findAmountByLabel(rows, [
    /^Accounts Payable$/i,
    /^Trade Creditors$/i,
    /^Trade Payables$/i,
  ]);

  return { raw, cash_total, trade_receivables, trade_payables };
}

/**
 * Fallback when there's no explicit "Total Bank" summary row: walk top-level
 * sections, find the one titled "Bank", and sum its Row entries' amounts.
 */
function sumBankSection(rows: XeroRow[]): number | null {
  for (const section of rows) {
    if (section.RowType !== "Section") continue;
    const title = section.Title ?? "";
    if (!/^Bank$/i.test(title)) continue;
    let total = 0;
    let found = false;
    for (const r of section.Rows ?? []) {
      if (r.RowType === "Row") {
        const v = parseAmount(r.Cells?.[1]);
        if (v != null) {
          total += v;
          found = true;
        }
      }
    }
    return found ? total : null;
  }
  return null;
}
