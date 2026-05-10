import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  LINNWORKS_APPLICATION_ID: z.string().min(1),
  LINNWORKS_APPLICATION_SECRET: z.string().min(1),
  LINNWORKS_TOKEN: z.string().min(1),

  ENABLE_CRON: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  SYNC_CRON_EXPRESSION: z.string().default("0 17 * * *"),
  SYNC_CRON_TZ: z.string().default("Europe/London"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
