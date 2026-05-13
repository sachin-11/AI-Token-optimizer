/**
 * Environment Configuration Module — SERVER ONLY
 *
 * Why Zod validation here:
 * - Fails fast at startup if required env vars are missing
 * - Provides type-safe access throughout the app
 * - Prevents runtime errors from misconfigured deployments
 * - Single source of truth for all environment variables
 */

import "server-only";

import { z } from "zod";

// ─── Schema Definition ────────────────────────────────────────────────────────

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("AI Prompt Optimizer"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  // Redis — Upstash (TCP via ioredis)
  // URL format: rediss://default:TOKEN@host.upstash.io:6380
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  // Upstash REST (used by @upstash/redis if needed, and for Vercel env reference)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // OpenAI — optional in dev so app starts without a real key
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required").default("sk-placeholder"),
  OPENAI_ORG_ID: z.string().optional(),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o"),
  OPENAI_FALLBACK_MODEL: z.string().default("gpt-4o-mini"),

  // Anthropic (optional — multi-model support)
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_DEFAULT_MODEL: z.string().default("claude-3-5-sonnet-20241022"),

  // Gemini (optional — multi-model support)
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEFAULT_MODEL: z.string().default("gemini-1.5-pro"),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  // BullMQ
  BULLMQ_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  BULLMQ_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),

  // Observability
  OTEL_SERVICE_NAME: z.string().default("ai-prompt-optimizer"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Semantic Cache
  SEMANTIC_CACHE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  SEMANTIC_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Security
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
  API_SECRET_KEY: z.string().min(16, "API_SECRET_KEY must be at least 16 characters"),

  // OAuth Providers
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // JWT
  JWT_ACCESS_TOKEN_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_TOKEN_EXPIRY: z.string().default("7d"),

  // Credentials login (email + password)
  // Set ENABLE_CREDENTIALS_LOGIN=true to allow email/password login in any environment.
  ENABLE_CREDENTIALS_LOGIN: z.enum(["true", "false"]).default("false"),
  DEV_LOGIN_EMAIL: z.string().email().optional(),
  DEV_LOGIN_PASSWORD: z.string().optional(),
});

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates and parses environment variables.
 * Throws a descriptive error at startup if validation fails —
 * better to crash early than fail silently in production.
 */
function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const { fieldErrors } = result.error.flatten();
    const errorMessages = Object.entries(fieldErrors)
      .map(([field, errors]) => `  ${field}: ${errors?.join(", ")}`)
      .join("\n");

    throw new Error(
      `❌ Invalid environment configuration:\n${errorMessages}\n\nCheck your .env.local file against .env.example`,
    );
  }

  return result.data;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

// Singleton — validated once at module load time
export const env = validateEnv();

// Inferred type for use throughout the app
export type Env = z.infer<typeof envSchema>;

// Convenience helpers
export const isDevelopment = env.NODE_ENV === "development";
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
