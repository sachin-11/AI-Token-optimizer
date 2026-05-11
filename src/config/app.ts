/**
 * Application-level constants and configuration.
 *
 * Separating app config from env config keeps concerns clean:
 * - env.ts = runtime environment variables (secrets, URLs)
 * - app.ts = static application constants (limits, defaults, feature flags)
 */

import { env } from "./env";

// ─── AI Model Configuration ───────────────────────────────────────────────────

export const AI_MODELS = {
  openai: {
    default: env.OPENAI_DEFAULT_MODEL,
    fallback: env.OPENAI_FALLBACK_MODEL,
    supported: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"] as const,
    contextWindows: {
      "gpt-4o": 128_000,
      "gpt-4o-mini": 128_000,
      "gpt-4-turbo": 128_000,
      "gpt-3.5-turbo": 16_385,
    } as Record<string, number>,
    costPerMToken: {
      // Cost in USD per million tokens (input/output)
      "gpt-4o": { input: 2.5, output: 10.0 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
      "gpt-4-turbo": { input: 10.0, output: 30.0 },
      "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    } as Record<string, { input: number; output: number }>,
  },
  anthropic: {
    default: env.ANTHROPIC_DEFAULT_MODEL,
    supported: [
      "claude-3-5-sonnet-20241022",
      "claude-3-haiku-20240307",
      "claude-3-opus-20240229",
    ] as const,
    contextWindows: {
      "claude-3-5-sonnet-20241022": 200_000,
      "claude-3-haiku-20240307": 200_000,
      "claude-3-opus-20240229": 200_000,
    } as Record<string, number>,
    costPerMToken: {
      "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
      "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
      "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
    } as Record<string, { input: number; output: number }>,
  },
} as const;

// ─── Token Limits ─────────────────────────────────────────────────────────────

export const TOKEN_LIMITS = {
  // Maximum tokens for a single optimization request
  maxInputTokens: 8_000,
  // Target compression ratio for prompt optimization
  targetCompressionRatio: 0.7,
  // Minimum tokens to trigger compression (below this, skip compression)
  compressionThreshold: 500,
  // Max tokens for context summarization
  maxSummaryTokens: 2_000,
} as const;

// ─── Queue Configuration ──────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  promptOptimization: "prompt-optimization",
  tokenAnalysis: "token-analysis",
  semanticCaching: "semantic-caching",
  costTracking: "cost-tracking",
} as const;

export const QUEUE_CONFIG = {
  defaultJobOptions: {
    attempts: env.BULLMQ_MAX_RETRIES,
    backoff: {
      type: "exponential" as const,
      delay: 1_000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
} as const;

// ─── API Configuration ────────────────────────────────────────────────────────

export const API_CONFIG = {
  version: "v1",
  basePath: "/api/v1",
  timeout: 30_000,
  // Streaming timeout is longer — LLM responses can be slow
  streamingTimeout: 120_000,
} as const;

// ─── Cache Configuration ──────────────────────────────────────────────────────

export const CACHE_CONFIG = {
  semantic: {
    similarityThreshold: env.SEMANTIC_CACHE_SIMILARITY_THRESHOLD,
    ttlSeconds: env.SEMANTIC_CACHE_TTL_SECONDS,
    maxEntries: 10_000,
  },
  response: {
    // Short TTL for API responses — data freshness matters
    ttlSeconds: 300,
  },
} as const;

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PAGINATION = {
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;
