import cors from "cors";
import express from "express";
import { env } from "./env.js";
import { syncRouter } from "./routes/sync.js";
import { xeroRouter } from "./routes/xero.js";
import { startCron } from "./cron.js";

const app = express();

const ALLOWED_ORIGINS = [
  "https://dashboard.northwestguitars.co.uk",
  "https://xero-nwg-dashboard.pages.dev",
  "http://localhost:5173",
];

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV });
});

app.use("/api", syncRouter);
app.use("/api/xero", xeroRouter);

app.listen(env.PORT, () => {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown";
  console.log(
    `[backend] listening on :${env.PORT} (${env.NODE_ENV}) — sync=v2(no-date-filter, diagnostics, line-counts)`,
  );
  console.error(`[boot] commit=${commit.slice(0, 7)}`);
  startCron();
});
