/**
 * Historical backfill for the dashboard's snapshot tables.
 *
 * Window (default 12 months back from today):
 *   - daily snapshots for the last 90 days
 *   - weekly snapshots (every Monday) for the preceding ~9 months
 *   - balance_sheet ONLY on month-end dates (Xero's BalanceSheet API rounds
 *     `date` to month-end, so a mid-month historical balance_sheet row would
 *     carry that month's month-end AR/AP — a future value relative to the
 *     snapshot date. AR/AP move slowly enough that monthly resolution is fine
 *     for the working-capital chart; it can lerp between month-end points.)
 *
 * For each target snapshot_date it writes (idempotent upsert on
 * (snapshot_date, period_type)):
 *   - xero_snapshots: mtd, trailing_90d  (+ balance_sheet on month-ends)
 *   - linnworks_financial_snapshots: mtd, trailing_90d
 *
 * Reuses syncXeroSnapshots() / syncFinancialSnapshots() so backfilled rows
 * are computed identically to live rows. GET /Accounts is fetched once for
 * the whole run. Xero rate limiting + 429 retry live in xeroGet().
 *
 * Resume-safe: --skip-existing (the default) skips a date whose rows already
 * exist. Crash mid-run → just re-run. Each date's Xero work and Linnworks
 * work are each a single upsert, so a date is all-or-nothing.
 *
 * Flags:
 *   --dry-run            print the plan (+ a one-call data-depth probe), no writes
 *   --force              re-fetch + overwrite even if rows already exist
 *   --months=N           window length in months (default 12)
 *   --xero-only          skip the Linnworks step
 *   --linnworks-only     skip the Xero step
 *
 * Run from backend/:  npm run backfill -- --dry-run
 *               then:  npm run backfill
 */
import "dotenv/config";
import { supabase } from "../db/supabase.js";
import { syncXeroSnapshots } from "../xero/sync.js";
import { fetchProfitAndLoss, fetchAccountTypes } from "../xero/reports.js";
import { XeroReconnectRequiredError } from "../xero/oauth.js";
import { syncFinancialSnapshots } from "../linnworks/financial.js";

// ---------- date helpers (local time, matching isoDate elsewhere) ----------
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return startOfDay(r);
}
function subMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() - n);
  return startOfDay(r);
}
function lastDayOfMonth(year: number, monthIdx: number): Date {
  return new Date(year, monthIdx + 1, 0, 0, 0, 0, 0);
}
function isMonthEnd(d: Date): boolean {
  return d.getDate() === lastDayOfMonth(d.getFullYear(), d.getMonth()).getDate();
}
function isMonday(d: Date): boolean {
  return d.getDay() === 1;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- flags ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const flagVal = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=", 2)[1];
};
const DRY_RUN = flag("dry-run");
const FORCE = flag("force");
const XERO_ONLY = flag("xero-only");
const LINNWORKS_ONLY = flag("linnworks-only");
const MONTHS = (() => {
  const v = Number(flagVal("months"));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 12;
})();
if (XERO_ONLY && LINNWORKS_ONLY) {
  console.error("Pass at most one of --xero-only / --linnworks-only.");
  process.exit(1);
}

// ---------- target date set ----------
type Cadence = "daily" | "weekly" | "month-end";
type Target = { date: Date; iso: string; monthEnd: boolean; tags: Cadence[] };

function buildTargets(): Target[] {
  const today = startOfDay(new Date());
  const windowStart = subMonths(today, MONTHS);
  const dailyStart = addDays(today, -89); // last 90 days inclusive of today

  const byIso = new Map<string, Target>();
  const add = (d: Date, tag: Cadence) => {
    const iso = isoDate(d);
    let t = byIso.get(iso);
    if (!t) {
      t = { date: startOfDay(d), iso, monthEnd: isMonthEnd(d), tags: [] };
      byIso.set(iso, t);
    }
    if (!t.tags.includes(tag)) t.tags.push(tag);
  };

  // daily: dailyStart..today  (clamped to windowStart in case MONTHS is tiny)
  for (let d = dailyStart < windowStart ? windowStart : dailyStart; d <= today; d = addDays(d, 1)) {
    add(d, "daily");
  }
  // weekly Mondays: windowStart..dailyStart (exclusive of dailyStart)
  for (let d = startOfDay(windowStart); d < dailyStart && d <= today; d = addDays(d, 1)) {
    if (isMonday(d)) add(d, "weekly");
  }
  // month-ends within [windowStart .. today]
  {
    const probe = startOfMonth(windowStart);
    for (let m = new Date(probe); m <= today; m.setMonth(m.getMonth() + 1)) {
      const me = lastDayOfMonth(m.getFullYear(), m.getMonth());
      if (me >= windowStart && me <= today) add(me, "month-end");
    }
  }

  return [...byIso.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ---------- skip-existing lookup ----------
async function loadExisting(): Promise<{ xero: Set<string>; lw: Set<string> }> {
  const xero = new Set<string>();
  const lw = new Set<string>();
  // .range guards against the 1000-row default cap (cf. PROGRESS.md PO note).
  const x = await supabase.from("xero_snapshots").select("snapshot_date, period_type").range(0, 9999);
  if (x.error) throw new Error(`reading xero_snapshots: ${x.error.message}`);
  for (const r of x.data ?? []) xero.add(`${r.snapshot_date}|${r.period_type}`);
  const l = await supabase
    .from("linnworks_financial_snapshots")
    .select("snapshot_date, period_type")
    .range(0, 9999);
  if (l.error) throw new Error(`reading linnworks_financial_snapshots: ${l.error.message}`);
  for (const r of l.data ?? []) lw.add(`${r.snapshot_date}|${r.period_type}`);
  return { xero, lw };
}
function xeroDone(iso: string, monthEnd: boolean, have: Set<string>): boolean {
  if (!have.has(`${iso}|mtd`) || !have.has(`${iso}|trailing_90d`)) return false;
  if (monthEnd && !have.has(`${iso}|balance_sheet`)) return false;
  return true;
}
function linnworksDone(iso: string, have: Set<string>): boolean {
  return have.has(`${iso}|trailing_90d`);
}

// ---------- run ----------
async function main() {
  const targets = buildTargets();
  const monthEnds = targets.filter((t) => t.monthEnd).length;
  const today = startOfDay(new Date());
  console.log(
    `Backfill window: ${isoDate(subMonths(today, MONTHS))} → ${isoDate(today)} (${MONTHS} months)\n` +
      `Targets: ${targets.length} dates (${targets.length - monthEnds} daily/weekly + ${monthEnds} month-end). ` +
      `Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}${FORCE ? " --force" : ""}` +
      `${XERO_ONLY ? " --xero-only" : ""}${LINNWORKS_ONLY ? " --linnworks-only" : ""}`,
  );

  const existing = FORCE ? { xero: new Set<string>(), lw: new Set<string>() } : await loadExisting();

  // Plan rows
  const plan = targets.map((t) => {
    const mtdStart = startOfMonth(t.date);
    const trailingStart = addDays(t.date, -90);
    const wantXero = !LINNWORKS_ONLY;
    const wantLw = !XERO_ONLY;
    const skipXero = wantXero && !FORCE && xeroDone(t.iso, t.monthEnd, existing.xero);
    const skipLw = wantLw && !FORCE && linnworksDone(t.iso, existing.lw);
    return {
      t,
      mtdWindow: `${isoDate(mtdStart)}..${t.iso}`,
      trailing90Window: `${isoDate(trailingStart)}..${t.iso}`,
      wantXero,
      wantLw,
      skipXero,
      skipLw,
    };
  });

  // ---------- DRY RUN ----------
  if (DRY_RUN) {
    for (const p of plan) {
      const tag = p.t.tags.join("+");
      const xeroNote = !p.wantXero
        ? "—"
        : p.skipXero
          ? "skip (exists)"
          : `mtd ${p.mtdWindow} | 90d ${p.trailing90Window}${p.t.monthEnd ? " | + balance_sheet" : ""}`;
      const lwNote = !p.wantLw ? "—" : p.skipLw ? "skip (exists)" : `mtd+90d (90d ${p.trailing90Window})`;
      console.log(`  ${p.t.iso}  [${tag}]  xero: ${xeroNote}   linnworks: ${lwNote}`);
    }

    // data-depth probe: the deepest window the backfill will request — the
    // oldest target's trailing-90d window (reaches further back than its mtd).
    const oldest = targets[0];
    const probeStart = addDays(oldest.date, -90);
    console.log(`\nData-depth probe — Xero P&L for ${isoDate(probeStart)}..${oldest.iso} (oldest target's 90d window):`);
    try {
      const probe = await fetchProfitAndLoss(probeStart, oldest.date);
      const rev = probe.revenue;
      const cogs = probe.cogs;
      if ((rev == null || rev === 0) && (cogs == null || cogs === 0)) {
        console.log(
          `  ⚠  revenue=${rev} cogs=${cogs} — looks like little/no data this far back. ` +
            `The Xero org ("Northwest Guitars (new)") may not extend a full ${MONTHS} months — consider a smaller --months, ` +
            `or expect the earliest rows to be partial/empty.`,
        );
      } else {
        console.log(`  ✓  revenue=${rev} cogs=${cogs} gross_profit=${probe.gross_profit} — data present at the back of the window.`);
      }
    } catch (err) {
      console.log(`  (probe failed — Xero not connected? ${err instanceof Error ? err.message : String(err)})`);
    }

    const xeroToRun = plan.filter((p) => p.wantXero && !p.skipXero);
    const lwToRun = plan.filter((p) => p.wantLw && !p.skipLw);
    const xeroCalls = xeroToRun.reduce((n, p) => n + 2 + (p.t.monthEnd ? 2 : 0), 0) + (xeroToRun.some((p) => p.t.monthEnd) ? 1 : 0); // +1 for the single /Accounts
    const lwCalls = lwToRun.length * 2;
    const estMin = Math.ceil(xeroCalls / 50) + Math.ceil((lwCalls * 6) / 60);
    console.log(
      `\nWould fetch: ~${xeroCalls} Xero calls (${xeroToRun.length} dates), ~${lwCalls} Linnworks calls (${lwToRun.length} dates). ` +
        `Est. runtime ~${estMin} min. ${plan.length - xeroToRun.length} Xero / ${plan.length - lwToRun.length} Linnworks dates already done.\n` +
        `Nothing was written. Re-run without --dry-run to execute.`,
    );
    return;
  }

  // ---------- LIVE RUN ----------
  // Pre-fetch /Accounts once: only needed if at least one month-end date will
  // run its Xero work. syncXeroSnapshots will fall back to fetching it if we
  // pass undefined, so this is purely an optimisation.
  let accountTypes: Map<string, string> | undefined;
  const needAccounts = !LINNWORKS_ONLY && plan.some((p) => p.wantXero && !p.skipXero && p.t.monthEnd);
  if (needAccounts) {
    accountTypes = await fetchAccountTypes();
    console.log(`Pre-fetched chart of accounts (${accountTypes.size} accounts).`);
  }

  let filled = 0;
  let skipped = 0;
  let errored = 0;
  for (const p of plan) {
    const parts: string[] = [];
    try {
      if (p.wantXero) {
        if (p.skipXero) {
          parts.push("xero: skip");
        } else {
          await syncXeroSnapshots(p.t.date, { accountTypes, includeBalanceSheet: p.t.monthEnd });
          parts.push(`xero: mtd ✓ 90d ✓${p.t.monthEnd ? " bs ✓" : ""}`);
        }
      }
      if (p.wantLw) {
        if (p.skipLw) {
          parts.push("linnworks: skip");
        } else {
          await syncFinancialSnapshots(p.t.date);
          parts.push("linnworks: mtd ✓ 90d ✓");
          await sleep(500); // light politeness spacer; calls are ~6s anyway
        }
      }
      const didWork = (p.wantXero && !p.skipXero) || (p.wantLw && !p.skipLw);
      if (didWork) filled++;
      else skipped++;
      console.log(`  ${p.t.iso}  ${parts.join("   ")}`);
    } catch (err) {
      if (err instanceof XeroReconnectRequiredError) {
        console.error(
          `\n✗ Xero connection died mid-backfill (${err.message}). Reconnect Xero in the dashboard, then re-run — completed dates will be skipped.`,
        );
        console.error(`Progress so far: ${filled} filled, ${skipped} skipped, ${errored} errored.`);
        process.exit(2);
      }
      errored++;
      console.error(`  ${p.t.iso}  ✗ ${err instanceof Error ? err.message : String(err)} — continuing`);
    }
  }

  console.log(`\nDone. ${filled} filled, ${skipped} skipped (already present), ${errored} errored.`);
  if (errored > 0) {
    console.log(`Re-run to retry the ${errored} errored date(s) (they weren't written, so skip-existing will pick them up).`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
