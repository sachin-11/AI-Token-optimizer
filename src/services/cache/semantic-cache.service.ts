/**
 * Semantic Cache Service
 *
 * Tier 2 — fuzzy cache. Finds responses for semantically similar prompts
 * even when the exact text differs.
 *
 * Two-layer approach:
 * 1. Redis: stores embedding vectors for fast in-memory similarity check
 * 2. pgvector: persistent storage for cross-restart cache survival
 *
 * Why two layers:
 * - Redis is faster but volatile (lost on restart)
 * - pgvector is persistent but slower (DB round-trip)
 * - Redis acts as L1, pgvector as L2
 *
 * Similarity search algorithm:
 * - Embed the incoming prompt
 * - Compare against stored embeddings using cosine similarity
 * - Return best match above threshold
 */

import "server-only";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { CacheKeyFactory } from "@/services/cache/cache-key.factory";
import { TtlManager } from "@/services/cache/ttl-manager";
import { getEmbeddingService } from "@/services/semantic/embedding.service";
import { getPgvectorService } from "@/services/semantic/pgvector.service";
import { CACHE_CONFIG } from "@/config/app";
import { CacheTier, type CacheEntry, type CacheResult } from "@/types/cache";
import type { AICompletionResponse, AIModel } from "@/types/ai";

const log = createChildLogger({ module: "SemanticCacheService" });

// Redis key for storing all embedding hashes (for similarity scan)
const EMBEDDING_INDEX_KEY = "apo:v1:sem:index";

export class SemanticCacheService {
  private readonly embedder = getEmbeddingService();
  private readonly pgvector = getPgvectorService();
  private readonly threshold = CACHE_CONFIG.semantic.similarityThreshold;

  /**
   * Look up a semantically similar cached response.
   * Checks Redis L1 first, then pgvector L2.
   */
  async get(
    prompt: string,
    model: AIModel,
    threshold?: number,
  ): Promise<CacheResult<AICompletionResponse>> {
    const start = Date.now();
    const effectiveThreshold = threshold ?? this.threshold;

    try {
      // Generate embedding for incoming prompt
      const embedding = await this.embedder.embed(prompt);

      // L1: Check Redis for similar embeddings
      const redisHit = await this.searchRedis(
        embedding.vector,
        model as string,
        effectiveThreshold,
      );

      if (redisHit) {
        log.debug({ similarity: redisHit.similarity, latencyMs: Date.now() - start }, "Semantic cache L1 hit");
        return {
          hit: true,
          entry: { ...redisHit, hitCount: redisHit.hitCount + 1 },
          tier: CacheTier.SEMANTIC,
          latencyMs: Date.now() - start,
        };
      }

      // L2: Check pgvector
      const pgHits = await this.pgvector.findSimilar({
        text: prompt,
        threshold: effectiveThreshold,
        limit: 1,
      });

      if (pgHits.length > 0 && pgHits[0]) {
        const pgHit = pgHits[0];
        let response: AICompletionResponse;

        try {
          response = JSON.parse(pgHit.response) as AICompletionResponse;
        } catch {
          return { hit: false, tier: null, latencyMs: Date.now() - start };
        }

        const promptHash = CacheKeyFactory.hashPrompt(prompt, model as string);
        const entry: CacheEntry<AICompletionResponse> = {
          data: { ...response, fromCache: true },
          tier: CacheTier.SEMANTIC,
          model,
          promptHash,
          hitCount: 1,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + TtlManager.semantic() * 1000).toISOString(),
          similarity: pgHit.similarity,
        };

        log.debug({ similarity: pgHit.similarity, latencyMs: Date.now() - start }, "Semantic cache L2 hit");
        return { hit: true, entry, tier: CacheTier.SEMANTIC, latencyMs: Date.now() - start };
      }

      return { hit: false, tier: null, latencyMs: Date.now() - start };
    } catch (error) {
      log.warn({ err: error }, "Semantic cache get failed — non-fatal");
      return { hit: false, tier: null, latencyMs: Date.now() - start };
    }
  }

  /**
   * Store a response in both Redis L1 and pgvector L2.
   */
  async set(
    prompt: string,
    model: AIModel,
    response: AICompletionResponse,
  ): Promise<void> {
    const promptHash = CacheKeyFactory.hashPrompt(prompt, model as string);
    const ttl = TtlManager.semantic();

    try {
      // Store embedding + response in Redis L1
      const embedding = await this.embedder.embed(prompt);
      const embKey = CacheKeyFactory.embedding(promptHash);

      const redisEntry = {
        vector: embedding.vector,
        response: JSON.stringify({ ...response, fromCache: true }),
        model,
        promptHash,
        similarity: 1.0,
        hitCount: 0,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      };

      await redis.setex(embKey, ttl, JSON.stringify(redisEntry));

      // Add to index for scan-based similarity search
      await redis.sadd(EMBEDDING_INDEX_KEY, promptHash);
      await redis.expire(EMBEDDING_INDEX_KEY, ttl * 2);

      // Store in pgvector L2 asynchronously
      void this.pgvector.storeEmbedding({
        promptHash,
        text: prompt,
        response: JSON.stringify({ ...response, fromCache: true }),
        model: model as string,
        ttlSeconds: ttl,
      });

      log.debug({ promptHash, model }, "Semantic cache set");
    } catch (error) {
      log.warn({ err: error }, "Semantic cache set failed — non-fatal");
    }
  }

  /**
   * Invalidate all semantic cache entries for a model.
   */
  async invalidateModel(model: AIModel): Promise<number> {
    const pattern = `apo:v1:emb:*`;
    let deleted = 0;
    let cursor = "0";

    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      for (const key of keys) {
        const raw = await redis.get(key);
        if (raw) {
          const entry = JSON.parse(raw) as { model?: string };
          if (entry.model === model) {
            await redis.del(key);
            deleted++;
          }
        }
      }
    } while (cursor !== "0");

    return deleted;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async searchRedis(
    queryVector: number[],
    model: string,
    threshold: number,
  ): Promise<(CacheEntry<AICompletionResponse> & { similarity: number }) | null> {
    // Get all cached embedding hashes from index
    const hashes = await redis.smembers(EMBEDDING_INDEX_KEY);
    if (hashes.length === 0) return null;

    let bestSimilarity = -1;
    let bestEntry: (CacheEntry<AICompletionResponse> & { similarity: number }) | null = null;

    // Scan embeddings — in production, limit to 500 for performance
    const scanLimit = Math.min(hashes.length, 500);

    for (const hash of hashes.slice(0, scanLimit)) {
      const key = CacheKeyFactory.embedding(hash);
      const raw = await redis.get(key);
      if (!raw) continue;

      const stored = JSON.parse(raw) as {
        vector: number[];
        response: string;
        model: string;
        promptHash: string;
        hitCount: number;
        createdAt: string;
        expiresAt: string;
      };

      // Only match same model
      if (stored.model !== model) continue;

      const similarity = this.embedder.cosineSimilarity(queryVector, stored.vector);

      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        let responseData: AICompletionResponse;
        try {
          responseData = JSON.parse(stored.response) as AICompletionResponse;
        } catch {
          continue;
        }

        bestEntry = {
          data: responseData,
          tier: CacheTier.SEMANTIC,
          model,
          promptHash: stored.promptHash,
          hitCount: stored.hitCount,
          createdAt: stored.createdAt,
          expiresAt: stored.expiresAt,
          similarity,
        };
      }
    }

    return bestEntry;
  }
}

let instance: SemanticCacheService | null = null;
export function getSemanticCache(): SemanticCacheService {
  instance ??= new SemanticCacheService();
  return instance;
}
