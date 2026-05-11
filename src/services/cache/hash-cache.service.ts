/**
 * Hash Cache Service
 *
 * Tier 1 — fastest cache. Exact SHA-256 hash of (model + normalized prompt).
 * O(1) Redis GET — sub-millisecond lookup.
 *
 * When to use:
 * - Same prompt sent multiple times (common in dev/testing)
 * - Repeated API calls with identical parameters
 * - Batch processing with duplicate prompts
 *
 * Stores the full AICompletionResponse so callers get identical shape
 * whether the response came from cache or the AI provider.
 */

import "server-only";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { CacheKeyFactory } from "@/services/cache/cache-key.factory";
import { TtlManager } from "@/services/cache/ttl-manager";
import { CacheTier, type CacheEntry, type CacheResult } from "@/types/cache";
import type { AICompletionResponse, AIModel } from "@/types/ai";

const log = createChildLogger({ module: "HashCacheService" });

export class HashCacheService {
  /**
   * Look up a cached response by exact prompt hash.
   */
  async get(
    prompt: string,
    model: AIModel,
  ): Promise<CacheResult<AICompletionResponse>> {
    const start = Date.now();
    const promptHash = CacheKeyFactory.hashPrompt(prompt, model as string);
    const redisKey = CacheKeyFactory.hashResponse(promptHash, model as string);

    try {
      const raw = await redis.get(redisKey);

      if (!raw) {
        return { hit: false, tier: null, latencyMs: Date.now() - start };
      }

      const entry = JSON.parse(raw) as CacheEntry<AICompletionResponse>;

      // Increment hit count asynchronously
      void this.incrementHitCount(redisKey, entry);

      log.debug({ promptHash, model, latencyMs: Date.now() - start }, "Hash cache hit");

      return {
        hit: true,
        entry: { ...entry, hitCount: entry.hitCount + 1 },
        tier: CacheTier.HASH,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      log.warn({ err: error }, "Hash cache get failed");
      return { hit: false, tier: null, latencyMs: Date.now() - start };
    }
  }

  /**
   * Store a response in the hash cache.
   */
  async set(
    prompt: string,
    model: AIModel,
    response: AICompletionResponse,
    ttlSeconds?: number,
  ): Promise<void> {
    const promptHash = CacheKeyFactory.hashPrompt(prompt, model as string);
    const redisKey = CacheKeyFactory.hashResponse(promptHash, model as string);
    const ttl = ttlSeconds ?? TtlManager.hashResponse(model as string);
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    const entry: CacheEntry<AICompletionResponse> = {
      data: { ...response, fromCache: true },
      tier: CacheTier.HASH,
      model,
      promptHash,
      hitCount: 0,
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    try {
      await redis.setex(redisKey, ttl, JSON.stringify(entry));
      log.debug({ promptHash, model, ttl }, "Hash cache set");
    } catch (error) {
      log.warn({ err: error }, "Hash cache set failed — non-fatal");
    }
  }

  /**
   * Delete a specific cache entry.
   */
  async invalidate(prompt: string, model: AIModel): Promise<boolean> {
    const promptHash = CacheKeyFactory.hashPrompt(prompt, model as string);
    const redisKey = CacheKeyFactory.hashResponse(promptHash, model as string);

    try {
      const deleted = await redis.del(redisKey);
      log.info({ promptHash, model }, "Hash cache invalidated");
      return deleted > 0;
    } catch {
      return false;
    }
  }

  /**
   * Delete all hash cache entries for a model.
   */
  async invalidateModel(model: AIModel): Promise<number> {
    const pattern = CacheKeyFactory.hashPattern(model as string);
    return this.deleteByPattern(pattern);
  }

  /**
   * Check if a prompt is cached without fetching the full response.
   */
  async exists(prompt: string, model: AIModel): Promise<boolean> {
    const promptHash = CacheKeyFactory.hashPrompt(prompt, model as string);
    const redisKey = CacheKeyFactory.hashResponse(promptHash, model as string);
    try {
      return (await redis.exists(redisKey)) === 1;
    } catch {
      return false;
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async incrementHitCount(
    key: string,
    entry: CacheEntry<AICompletionResponse>,
  ): Promise<void> {
    try {
      const updated = { ...entry, hitCount: entry.hitCount + 1 };
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        await redis.setex(key, ttl, JSON.stringify(updated));
      }
    } catch {
      // Non-fatal
    }
  }

  private async deleteByPattern(pattern: string): Promise<number> {
    let deleted = 0;
    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== "0");

    return deleted;
  }
}

let instance: HashCacheService | null = null;
export function getHashCache(): HashCacheService {
  instance ??= new HashCacheService();
  return instance;
}
