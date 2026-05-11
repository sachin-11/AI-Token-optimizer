/**
 * TTL Manager
 *
 * Centralizes TTL logic for all cache tiers.
 *
 * TTL strategy:
 * - Embeddings: long TTL (24h) — deterministic, never change for same text
 * - Hash responses: medium TTL (1h) — AI responses are stable but models update
 * - Semantic cache: configurable (default 1h) — from env config
 * - Stats: very long TTL (7d) — aggregated, low churn
 *
 * Dynamic TTL: expensive model responses get longer TTL
 * (GPT-4o costs 16x more than gpt-4o-mini — worth caching longer)
 */

import { CACHE_CONFIG } from "@/config/app";

// ─── Base TTLs (seconds) ──────────────────────────────────────────────────────

const BASE_TTLS = {
  embedding:    86_400,   // 24 hours
  hashResponse: 3_600,    // 1 hour
  semantic:     CACHE_CONFIG.semantic.ttlSeconds,
  meta:         86_400,   // 24 hours
  stats:        604_800,  // 7 days
  rateLimit:    60,       // 1 minute window
} as const;

// Models that warrant longer cache TTL due to high cost
const HIGH_VALUE_MODELS = new Set([
  "gpt-4o",
  "gpt-4-turbo",
  "claude-3-opus-20240229",
  "claude-3-5-sonnet-20241022",
]);

export const TtlManager = {
  embedding(): number {
    return BASE_TTLS.embedding;
  },

  hashResponse(model: string): number {
    // High-value models cached 4x longer — cost savings justify it
    return HIGH_VALUE_MODELS.has(model)
      ? BASE_TTLS.hashResponse * 4
      : BASE_TTLS.hashResponse;
  },

  semantic(): number {
    return BASE_TTLS.semantic;
  },

  meta(): number {
    return BASE_TTLS.meta;
  },

  stats(): number {
    return BASE_TTLS.stats;
  },

  rateLimit(): number {
    return BASE_TTLS.rateLimit;
  },

  /**
   * Calculate remaining TTL as a fraction (0-1).
   * Used to decide whether to refresh a cache entry.
   */
  remainingFraction(expiresAt: string): number {
    const now = Date.now();
    const expires = new Date(expiresAt).getTime();
    const created = expires - BASE_TTLS.hashResponse * 1000;
    const total = expires - created;
    const remaining = expires - now;
    return Math.max(0, remaining / total);
  },

  /**
   * Should we refresh this entry proactively?
   * Refresh when < 20% TTL remains (stale-while-revalidate pattern).
   */
  shouldRefresh(expiresAt: string): boolean {
    return this.remainingFraction(expiresAt) < 0.2;
  },
} as const;
