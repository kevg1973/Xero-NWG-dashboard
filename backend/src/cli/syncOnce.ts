import { runSyncs } from "../linnworks/runSyncs.js";
import type { SyncMode } from "../linnworks/sync.js";

async function main() {
  const mode: SyncMode = process.argv.includes("--full") ? "full" : "incremental";
  const result = await runSyncs({ trigger: "manual", mode });

  console.log(JSON.stringify(
    {
      ok: result.ok,
      po: result.po.summary ?? { error: result.po.error },
      financial: result.financial.summary ?? { error: result.financial.error },
      xero: result.xero.summary ?? { error: result.xero.error },
    },
    null,
    2,
  ));

  process.exit(result.ok ? 0 : 1);
}

main();
