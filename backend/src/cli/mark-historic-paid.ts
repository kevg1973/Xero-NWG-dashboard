/**
 * One-shot CLI: mark historic POs as "paid in full upfront", dated at po_date.
 *
 * Every PO ordered before the cutoff that has never had a payment recorded
 * gets `payment_amount = po_value_gbp`, `payment_date = po_date`, and a fixed
 * note. We deliberately date the payment at po_date (not today) so the
 * cash-out trend chart attributes ~£3.9M of historic spend to roughly when it
 * happened, instead of dumping it all on today's date.
 *
 * Match rule (a row is updated iff ALL hold):
 *   - po_date < CUTOFF
 *   - po_value_gbp > 0  (the ~1378 £0-value historic POs — overwhelmingly
 *     pre-2021, where Linnworks didn't carry values — stay untouched rather
 *     than getting a misleading "paid in full" status / fake payment_date;
 *     £0 contributes nothing to the cash trend anyway)
 *   - payment_amount IS NULL AND deposit_amount IS NULL AND balance_amount IS NULL
 *     (i.e. no payment of any kind has been recorded — this is the real
 *     "never edited" signal; `payment_terms` is always 'upfront' on every row
 *     so it can't distinguish edited from unedited)
 *   - no constraint on linnworks_status (OPEN / PARTIAL / DELIVERED all included)
 *
 * Set on each match:
 *   - payment_amount = po_value_gbp
 *   - payment_date   = po_date
 *   - notes          = NOTE  (today's date baked in, same for every row in
 *                             this run — easy to identify the batch later)
 *   - payment_terms is left untouched (already 'upfront' on all matches)
 *
 * The write is a single server-side UPDATE inside the SQL function
 * public.mark_historic_pos_paid(date, text) — supabase-js can't express a
 * column-referencing UPDATE (`SET payment_amount = po_value_gbp`), so the
 * actual mutation lives in the function (migration: fn_mark_historic_pos_paid).
 * Idempotent: a re-run matches nothing, because updated rows now have
 * payment_amount set.
 *
 * Run from backend/:
 *   npm run mark-historic-paid                # dry run (default): count + sample, no writes
 *   npm run mark-historic-paid -- --dry-run   # same
 *   npm run mark-historic-paid -- --force     # actually run the UPDATE
 *
 * Strictly manual. No cron, no API route.
 */
import "dotenv/config";
import { supabase } from "../db/supabase.js";

const CUTOFF = "2026-03-15"; // po_date strictly before this
const NOTE = "Backfilled as paid — historic PO (auto-marked 2026-05-12)";

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const DRY_RUN = !FORCE || argv.includes("--dry-run"); // dry-run unless --force (and not also --dry-run)

// Shared WHERE clause: po_date < CUTOFF, po_value_gbp > 0, and no payment of
// any kind recorded. (Inlined per call site — supabase-js's builder types make
// a generic helper awkward; the chain is short.)
async function countMatches(): Promise<number> {
  const { count, error } = await supabase
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .lt("po_date", CUTOFF)
    .gt("po_value_gbp", 0)
    .is("payment_amount", null)
    .is("deposit_amount", null)
    .is("balance_amount", null);
  if (error) throw new Error(`count failed: ${error.message}`);
  return count ?? 0;
}

async function sumPoValueGbp(): Promise<number> {
  // Paginate around the 1000-row default cap; sum client-side.
  let total = 0;
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("po_value_gbp")
      .lt("po_date", CUTOFF)
      .gt("po_value_gbp", 0)
      .is("payment_amount", null)
      .is("deposit_amount", null)
      .is("balance_amount", null)
      .range(from, from + page - 1);
    if (error) throw new Error(`sum fetch failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ po_value_gbp: number | null }>;
    for (const r of rows) total += Number(r.po_value_gbp ?? 0);
    if (rows.length < page) break;
    from += page;
  }
  return total;
}

async function sample(n: number) {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id, po_number, supplier_name, po_date, po_value_gbp")
    .lt("po_date", CUTOFF)
    .gt("po_value_gbp", 0)
    .is("payment_amount", null)
    .is("deposit_amount", null)
    .is("balance_amount", null)
    .order("po_date", { ascending: true })
    .limit(n);
  if (error) throw new Error(`sample failed: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    po_number: string | null;
    supplier_name: string | null;
    po_date: string | null;
    po_value_gbp: number | null;
  }>;
}

function fmtGbp(n: number | null): string {
  if (n == null) return "(null)";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
}

async function main() {
  console.log(
    `mark-historic-paid — cutoff po_date < ${CUTOFF}, note="${NOTE}". Mode: ${DRY_RUN ? "DRY RUN" : "LIVE (--force)"}`,
  );

  const count = await countMatches();
  console.log(`Matched rows (po_date < ${CUTOFF}, po_value_gbp > 0, no payment recorded): ${count}`);
  if (count === 0) {
    console.log("Nothing to do.");
    return;
  }

  const total = await sumPoValueGbp();
  console.log(`Total po_value_gbp of matched rows: ${fmtGbp(total)} (this will be set as payment_amount, dated at each row's po_date)`);

  const rows = await sample(10);
  console.log(`\nSample (10 oldest matches):`);
  for (const r of rows) {
    console.log(
      `  ${r.po_date ?? "(no date)"}  ${r.po_number ?? "(no PO#)"}  ${(r.supplier_name ?? "Unknown supplier").slice(0, 30).padEnd(30)}  value=${fmtGbp(r.po_value_gbp)}`,
    );
  }
  console.log(
    `\nEach matched row → payment_amount = po_value_gbp, payment_date = po_date, notes = ${JSON.stringify(NOTE)}; payment_terms untouched.`,
  );

  if (DRY_RUN) {
    console.log(`\nDRY RUN — nothing written. Re-run with --force to execute.`);
    return;
  }

  console.log(`\nExecuting UPDATE…`);
  const { data, error } = await supabase.rpc("mark_historic_pos_paid", { p_cutoff: CUTOFF, p_note: NOTE });
  if (error) throw new Error(`UPDATE failed: ${error.message}`);
  console.log(`Done. Updated ${data ?? "?"} rows.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
