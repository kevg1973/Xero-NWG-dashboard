import cron from "node-cron";
import { env } from "./env.js";
import { runSyncs } from "./linnworks/runSyncs.js";

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
      console.log("[cron] sync starting");
      const result = await runSyncs({ trigger: "cron" });
      console.log("[cron] po:", result.po.error ? `FAIL ${result.po.error}` : result.po.summary);
      console.log("[cron] financial:", result.financial.error ? `FAIL ${result.financial.error}` : result.financial.summary);
      console.log("[cron] xero:", result.xero.error ? `FAIL ${result.xero.error}` : result.xero.summary);
    },
    { timezone: env.SYNC_CRON_TZ },
  );
}
