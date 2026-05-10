import { syncPurchaseOrders, type SyncMode } from "../linnworks/sync.js";
import { recordSync } from "../db/syncLog.js";

async function main() {
  const mode: SyncMode = process.argv.includes("--full") ? "full" : "incremental";
  const startedAt = Date.now();
  try {
    const summary = await syncPurchaseOrders(mode);
    await recordSync({
      source: "linnworks_po",
      trigger: "manual",
      ok: true,
      detail: { mode, ...summary, via: "cli" },
      error: null,
      duration_ms: Date.now() - startedAt,
    });
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordSync({
      source: "linnworks_po",
      trigger: "manual",
      ok: false,
      detail: { mode, via: "cli" },
      error: message,
      duration_ms: Date.now() - startedAt,
    });
    console.error("sync failed:", message);
    process.exit(1);
  }
}

main();
