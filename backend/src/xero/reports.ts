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
  trade_receivables: number | null;
  trade_payables: number | null;
};

/**
 * Xero's BalanceSheet API silently rounds the requested `date` to the end of
 * the period (default: month-end). There is no parameter combination that
 * makes it honour a mid-month date — it's a known multi-year API limitation
 * (open Xero UserVoice item).
 *
 * In practice, within the current month Xero seems to use today's posted
 * balances and just label them with the upcoming month-end — verified by
 * comparing AR figures between this endpoint and other day-accurate Xero
 * tools. So daily AR/AP snapshots still update day-to-day; only the "as at"
 * label drifts. We log the label here so any future change in this behaviour
 * is visible in production logs.
 *
 * For cash_total we use the dedicated BankSummary report instead (see
 * fetchBankSummary) — that endpoint does honour arbitrary dates and avoids
 * the month-boundary discontinuity.
 */
export async function fetchBalanceSheet(asOf: Date): Promise<BalanceSheetResult> {
  const requestedDate = isoDate(asOf);
  const raw = await xeroGet<XeroReportEnvelope<XeroReport>>("/Reports/BalanceSheet", {
    date: requestedDate,
  });
  logReportDateMismatch("BalanceSheet", requestedDate, raw);
  const report = raw.Reports?.[0];
  const rows = report?.Rows ?? [];

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

  return { raw, trade_receivables, trade_payables };
}

/**
 * Reads the chart of accounts and returns accountID → BankAccountType
 * ("BANK" | "CREDITCARD" | "PAYPAL" | "NONE" | ""). Only bank-type accounts
 * have a meaningful BankAccountType; everything else maps to "".
 */
export async function fetchAccountTypes(): Promise<Map<string, string>> {
  const raw = await xeroGet<{ Accounts?: Array<{ AccountID?: string; BankAccountType?: string }> }>(
    "/Accounts",
  );
  const map = new Map<string, string>();
  for (const a of raw.Accounts ?? []) {
    if (a.AccountID) map.set(a.AccountID, a.BankAccountType ?? "");
  }
  return map;
}

export type BankSummaryResult = {
  raw: XeroReportEnvelope;
  cash_total: number | null;
  credit_card_liability: number | null;
};

/**
 * BankSummary report: lists every "bank"-type account (real banks, PayPal,
 * AND credit cards) with opening/closing balances for a date range. Unlike
 * BalanceSheet, this endpoint honours arbitrary dates — fromDate=toDate=asOf
 * gives a one-day window and the closing balance per account.
 *
 * Cells per row: [account name, opening, cash received, cash spent, FX gain,
 * closing]. The account's UUID is in cell[0].Attributes (Id="accountID").
 *
 * We classify each row by BankAccountType (from fetchAccountTypes):
 *   - BANK, PAYPAL → cash_total (PayPal stays in cash even though NWG's
 *     PayPal balance is currently negative — that's a separate mapping issue)
 *   - CREDITCARD → credit_card_liability (short-term liability, surfaced as
 *     its own metric rather than netted out — useful working-capital signal)
 *   - anything else / not found in the chart of accounts → logged as a
 *     warning and excluded from BOTH totals, so a new account type can never
 *     silently land in the wrong bucket.
 *
 * Returns null/null only if no rows could be classified at all (empty or
 * unparseable report); a zero in either bucket is a real value.
 */
export async function fetchBankSummary(
  asOf: Date,
  accountTypes: Map<string, string>,
): Promise<BankSummaryResult> {
  const requestedDate = isoDate(asOf);
  const raw = await xeroGet<XeroReportEnvelope<XeroReport>>("/Reports/BankSummary", {
    fromDate: requestedDate,
    toDate: requestedDate,
  });
  logReportDateMismatch("BankSummary", requestedDate, raw);

  let cash = 0;
  let credit = 0;
  let classifiedAny = false;
  for (const row of flatten(raw.Reports?.[0]?.Rows ?? [])) {
    if (row.RowType !== "Row") continue;
    const nameCell = row.Cells?.[0];
    const accountId = nameCell?.Attributes?.find((a) => a.Id === "accountID")?.Value;
    const closing = parseAmount(row.Cells?.[(row.Cells?.length ?? 1) - 1]);
    if (closing == null) continue;
    const type = accountId ? accountTypes.get(accountId) : undefined;
    if (type === "BANK" || type === "PAYPAL") {
      cash += closing;
      classifiedAny = true;
    } else if (type === "CREDITCARD") {
      credit += closing;
      classifiedAny = true;
    } else {
      process.stderr.write(
        `[xero/BankSummary] WARNING unclassified bank account id=${accountId ?? "?"} ` +
          `name="${nameCell?.Value ?? ""}" bankAccountType=${type ?? "(not in /Accounts)"} ` +
          `closing=${closing} — excluded from cash_total and credit_card_liability\n`,
      );
    }
  }

  return {
    raw,
    cash_total: classifiedAny ? round2(cash) : null,
    credit_card_liability: classifiedAny ? round2(credit) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Logs a one-liner when Xero's reported "as at" / period title doesn't match
 * what we requested. ReportTitles[2] is conventionally the period string
 * (e.g. "As at 31 May 2026" or "From X To Y"). stderr so Railway can't buffer.
 */
function logReportDateMismatch(reportName: string, requestedDate: string, raw: XeroReportEnvelope): void {
  const titles = (raw.Reports?.[0] as { ReportTitles?: string[] } | undefined)?.ReportTitles ?? [];
  const period = titles[2] ?? "";
  const matches = period.includes(requestedDate) ||
    period.toLowerCase().includes(formatHumanDate(requestedDate).toLowerCase());
  process.stderr.write(
    `[xero/${reportName}] requested=${requestedDate} xero_period="${period}" honoured=${matches}\n`,
  );
}

function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

