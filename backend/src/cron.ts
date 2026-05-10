import cron from "node-cron";
import { env } from "./env.js";
import { syncPurchaseOrders } from "./linnworks/sync.js";
import { recordSync } from "./db/syncLog.js";

export function startCron() {
  if (!env.ENABLE_CRON) {
    console.log("[cron] disabled (ENABLE_CRON != true)");
    return;
  }
  if (!cron.validate(env.SYNC_CRON_EXPRESSION)) {
    console.error(`[cron] invalid expression: ${env.SYNC_CRON_EXPRESSION}`);
    return;
  }

  console.log(`[cron] scheduled '${env.SYNC_CRON_EXPRESSION}' (${env.SYNC_CRON_TZ})`);

  cron.schedule(
    env.SYNC_CRON_EXPRESSION,
    async () => {
      const startedAt = Date.now();
      console.log("[cron] sync starting");
      try {
        const summary = await syncPurchaseOrders("incremental");
        await recordSync({
          source: "linnworks_po",
          trigger: "cron",
          ok: true,
          detail: summary,
          error: null,
          duration_ms: Date.now() - startedAt,
        });
        console.log("[cron] sync ok", summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordSync({
          source: "linnworks_po",
          trigger: "cron",
          ok: false,
          detail: null,
          error: message,
          duration_ms: Date.now() - startedAt,
        });
        console.error("[cron] sync failed:", message);
      }
    },
    { timezone: env.SYNC_CRON_TZ },
  );
}
