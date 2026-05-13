/**
 * Cache Key Factory
 *
 * Centralizes all Redis key construction.
 * Why a dedicated factory:
 * - Key collisions are silent bugs — one place prevents them
 * - Namespaced keys make Redis Commander readable
 * - Easy to change key structure without hunting across files
 * - Enables pattern-based invalidation (e.g. delete all keys for a user)
 *
 * Key schema:
 *   {app}:{version}:{tier}:{...segments}
 *
 * Examples:
 *   apo:v1:hash:abc123def456          — exact hash cache
 *   apo:v1:emb:abc123def456           — embedding vector
 *   apo:v1:meta:abc123def456          — response metadata
 *   apo:v1:stats:global               — global cache stats
 *   apo:v1:stats:user:usr_123         — per-user stats
 */

import crypto from "crypto";

const APP_PREFIX = "apo";   // ai-prompt-optimizer
const VERSION    = "v1";

function key(...segments: string[]): string {
  return [APP_PREFIX, VERSION, ...segments].join(":");
}

export const CacheKeyFactory = {
  // ── Hash Cache ─────────────────────────────────────────────────────────────

  /** Exact prompt hash → AI response */
  hashResponse(promptHash: string, model: string): string {
    return key("hash", model, promptHash);
  },

  /** Pattern to match all hash cache keys for a model */
  hashPattern(model: string): string {
    return key("hash", model, "*");
  },

  // ── Embedding Cache ────────────────────────────────────────────────────────

  /** Text hash → embedding vector */
  embedding(textHash: string): string {
    return key("emb", textHash);
  },

  /** Pattern to match all embedding keys */
  embeddingPattern(): string {
    return key("emb", "*");
  },

  // ── Metadata ───────────────────────────────────────────────────────────────

  /** Cache entry metadata (hit count, timestamps) */
  meta(promptHash: string): string {
    return key("meta", promptHash);
  },

  // ── Stats ──────────────────────────────────────────────────────────────────

  globalStats(): string {
    return key("stats", "global");
  },

  userStats(userId: string): string {
    return key("stats", "user", userId);
  },

  // ── Rate Limiting ──────────────────────────────────────────────────────────

  rateLimit(userId: string, windowKey: string): string {
    return key("rl", userId, windowKey);
  },

  // ── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Hash a prompt for use as a cache key.
   * Normalizes whitespace and case for better hit rates.
   */
  hashPrompt(prompt: string, model: string): string {
    const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
    return crypto
      .createHash("sha256")
      .update(`${model}:${normalized}`)
      .digest("hex")
      .slice(0, 24);
  },

  /**
   * Hash messages array — order-sensitive.
   */
  hashMessages(
    messages: Array<{ role: string; content: string }>,
    model: string,
  ): string {
    const normalized = messages
      .map((m) => `${m.role}:${m.content.trim().toLowerCase()}`)
      .join("|");
    return crypto
      .createHash("sha256")
      .update(`${model}:${normalized}`)
      .digest("hex")
      .slice(0, 24);
  },

  /**
   * Exact key for workflow optimization cache (prompt + model + mode + optional target).
   * Full 64-char hex — independent of AI response hash (different namespace).
   */
  hashOptimizationInput(prompt: string, model: string, mode: string, targetTokens?: number): string {
    const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
    const payload = `${model}\0${mode}\0${targetTokens ?? ""}\0${normalized}`;
    return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  },

  /** Redis key for cached WorkflowResult JSON */
  optimizationWorkflow(inputHash: string): string {
    return key("optwf", inputHash);
  },
} as const;
