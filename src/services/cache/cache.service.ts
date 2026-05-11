/**
 * Cache Service — Unified Facade
 *
 * Single entry point for all caching operations.
 * Orchestrates the two-tier lookup:
 *
 *   Request
 *     │
 *     ▼
 *   [Tier 1] Hash Cache (Redis, exact match, ~0.5ms)
 *     │ miss
 *     ▼
 *   [Tier 2] Semantic Cache (Redis L1 + pgvector L2, ~50-100ms)
 *     │ miss
 *     ▼
 *   AI Provider call
 *     │
 *     ▼
 *   Store in both tiers asynchronously
 *
 * Why this order:
 * - Hash cache is O(1) and sub-millisecond — always check first
 * - Semantic cache requires embedding generation (~20ms) — only on hash miss
 * - Storing is async — never blocks the response path
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getHashCache } from "@/services/cache/hash-cache.service";
import { getSemanticCache } from "@/services/cache/semantic-cache.service";
import { getCacheStats } from "@/services/cache/cache-stats.service";
import { CacheTier, type CacheGetOptions, type CacheResult, type CacheSetOptions } from "@/types/cache";
import type { AICompletionResponse, AIModel } from "@/types/ai";

const log = createChildLogger({ module: "CacheService" });

export class CacheService {
  private readonly hashCache    = getHashCache();
  private readonly semanticCache = getSemanticCache();
  private readonly stats        = getCacheStats();

  /**
   * Look up a cached AI response.
   * Checks hash cache first, then semantic cache.
   */
  async get(
    prompt: string,
    model: AIModel,
    options: CacheGetOptions = {},
  ): Promise<CacheResult<AICompletionResponse>> {
    // Tier 1: exact hash lookup
    const hashResult = await this.hashCache.get(prompt, model);

    if (hashResult.hit) {
      void this.stats.recordHit(CacheTier.HASH, hashResult.latencyMs);
      log.debug({ model, tier: "hash" }, "Cache hit");
      return hashResult;
    }

    // Tier 2: semantic similarity (skip if caller opts out)
    if (!options.skipSemantic) {
      const semanticResult = await this.semanticCache.get(
        prompt,
        model,
        options.similarityThreshold,
      );

      if (semanticResult.hit) {
        void this.stats.recordHit(CacheTier.SEMANTIC, semanticResult.latencyMs);
        log.debug({ model, tier: "semantic", similarity: semanticResult.entry.similarity }, "Cache hit");
        return semanticResult;
      }
    }

    const totalLatency = hashResult.latencyMs;
    void this.stats.recordMiss(totalLatency);
    return { hit: false, tier: null, latencyMs: totalLatency };
  }

  /**
   * Store an AI response in the cache.
   * Both tiers are written asynchronously — never blocks the caller.
   */
  async set(
    prompt: string,
    model: AIModel,
    response: AICompletionResponse,
    options: CacheSetOptions = {},
  ): Promise<void> {
    // Always store in hash cache
    void this.hashCache.set(prompt, model, response, options.ttlSeconds);

    // Store in semantic cache unless explicitly skipped
    if (options.storeInSemanticCache !== false) {
      void this.semanticCache.set(prompt, model, response);
    }
  }

  /**
   * Invalidate a specific prompt from all cache tiers.
   */
  async invalidate(prompt: string, model: AIModel): Promise<void> {
    await Promise.all([
      this.hashCache.invalidate(prompt, model),
    ]);
    log.info({ model }, "Cache invalidated for prompt");
  }

  /**
   * Invalidate all cache entries for a model.
   * Use when a model is updated or deprecated.
   */
  async invalidateModel(model: AIModel): Promise<{ hashDeleted: number; semanticDeleted: number }> {
    const [hashDeleted, semanticDeleted] = await Promise.all([
      this.hashCache.invalidateModel(model),
      this.semanticCache.invalidateModel(model),
    ]);

    log.info({ model, hashDeleted, semanticDeleted }, "Model cache invalidated");
    return { hashDeleted, semanticDeleted };
  }

  /**
   * Check if a prompt is cached (without fetching the response).
   */
  async exists(prompt: string, model: AIModel): Promise<boolean> {
    return this.hashCache.exists(prompt, model);
  }

  /**
   * Get cache performance statistics.
   */
  async getStats() {
    return this.stats.getStats();
  }

  /**
   * Wrap an AI call with cache-aside pattern.
   * If cached → return immediately.
   * If not → call the provider, store result, return.
   *
   * @example
   * const response = await cache.wrap(
   *   prompt, model,
   *   () => router.complete({ messages, model }),
   * );
   */
  async wrap(
    prompt: string,
    model: AIModel,
    fn: () => Promise<AICompletionResponse>,
    options: CacheGetOptions & CacheSetOptions = {},
  ): Promise<AICompletionResponse & { fromCache: boolean }> {
    const cached = await this.get(prompt, model, options);

    if (cached.hit) {
      return { ...cached.entry.data, fromCache: true };
    }

    const response = await fn();

    // Store asynchronously — don't block the response
    void this.set(prompt, model, response, options);

    return { ...response, fromCache: false };
  }
}

let instance: CacheService | null = null;
export function getCacheService(): CacheService {
  instance ??= new CacheService();
  return instance;
}
