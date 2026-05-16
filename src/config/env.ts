import "dotenv/config"
import { z } from "zod"

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_TTL: z.string().default("7d"),
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate with `openssl rand -hex 32`."
    ),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_NAME: z.string().default("cb_session"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  COOKIE_SAMESITE: z
    .enum(["lax", "strict", "none"])
    .default("lax"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("cuebites-esign"),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error("Invalid environment variables:")
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
