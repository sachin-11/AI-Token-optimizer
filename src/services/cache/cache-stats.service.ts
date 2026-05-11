/**
 * Cache Stats Service
 *
 * Tracks cache performance metrics in Redis.
 * Uses atomic INCR operations — safe under concurrent requests.
 */

import "server-only";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { CacheKeyFactory } from "@/services/cache/cache-key.factory";
import { TtlManager } from "@/services/cache/ttl-manager";
import { CacheTier, type CacheStats } from "@/types/cache";

const log = createChildLogger({ module: "CacheStatsService" });

export class CacheStatsService {
  /**
   * Record a cache hit.
   */
  async recordHit(tier: CacheTier, latencyMs: number, savedCostUsd = 0): Promise<void> {
    const key = CacheKeyFactory.globalStats();
    try {
      await redis.hincrbyfloat(key, `${tier}_hits`, 1);
      await redis.hincrbyfloat(key, "total_requests", 1);
      await redis.hincrbyfloat(key, "total_latency_ms", latencyMs);
      await redis.hincrbyfloat(key, "estimated_savings_usd", savedCostUsd);
      await redis.expire(key, TtlManager.stats());
    } catch {
      // Stats failure is never fatal
    }
  }

  /**
   * Record a cache miss.
   */
  async recordMiss(latencyMs: number): Promise<void> {
    const key = CacheKeyFactory.globalStats();
    try {
      await redis.hincrbyfloat(key, "misses", 1);
      await redis.hincrbyfloat(key, "total_requests", 1);
      await redis.hincrbyfloat(key, "total_latency_ms", latencyMs);
      await redis.expire(key, TtlManager.stats());
    } catch {}
  }

  /**
   * Get aggregated cache statistics.
   */
  async getStats(): Promise<CacheStats> {
    const key = CacheKeyFactory.globalStats();

    try {
      const raw = await redis.hgetall(key);

      const hashHits      = Number(raw["hash_hits"]            ?? 0);
      const semanticHits  = Number(raw["semantic_hits"]        ?? 0);
      const misses        = Number(raw["misses"]               ?? 0);
      const totalRequests = Number(raw["total_requests"]       ?? 0);
      const totalLatency  = Number(raw["total_latency_ms"]     ?? 0);
      const savings       = Number(raw["estimated_savings_usd"]?? 0);

      return {
        hashHits,
        semanticHits,
        misses,
        totalRequests,
        hitRate: totalRequests > 0
          ? Number(((hashHits + semanticHits) / totalRequests).toFixed(4))
          : 0,
        avgLatencyMs: totalRequests > 0
          ? Number((totalLatency / totalRequests).toFixed(2))
          : 0,
        estimatedSavingsUsd: Number(savings.toFixed(6)),
      };
    } catch (error) {
      log.warn({ err: error }, "Failed to get cache stats");
      return {
        hashHits: 0, semanticHits: 0, misses: 0,
        totalRequests: 0, hitRate: 0, avgLatencyMs: 0, estimatedSavingsUsd: 0,
      };
    }
  }

  /**
   * Reset all stats — useful for testing or monthly resets.
   */
  async resetStats(): Promise<void> {
    await redis.del(CacheKeyFactory.globalStats());
  }
}

let instance: CacheStatsService | null = null;
export function getCacheStats(): CacheStatsService {
  instance ??= new CacheStatsService();
  return instance;
}
