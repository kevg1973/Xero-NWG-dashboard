import cors from "cors";
import express from "express";
import { env } from "./env.js";
import { syncRouter } from "./routes/sync.js";
import { startCron } from "./cron.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV });
});

app.use("/api", syncRouter);

app.listen(env.PORT, () => {
  console.log(
    `[backend] listening on :${env.PORT} (${env.NODE_ENV}) — sync=v2(no-date-filter, diagnostics, line-counts)`,
  );
  startCron();
});
