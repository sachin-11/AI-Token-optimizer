/**
 * pgvector Service
 *
 * Stores and searches embeddings in PostgreSQL via pgvector.
 * Used for semantic cache — find cached responses for semantically
 * similar prompts without exact hash match.
 *
 * Why pgvector over a dedicated vector DB:
 * - We already have Postgres — no extra infra
 * - pgvector handles millions of vectors efficiently with HNSW index
 * - ACID transactions — cache entries are consistent with other data
 * - Simpler ops — one DB to manage
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { createChildLogger } from "@/lib/logger";
import { getEmbeddingService } from "@/services/semantic/embedding.service";
import type { EmbeddingCacheEntry, VectorSearchResult } from "@/types/semantic";

const log = createChildLogger({ module: "PgvectorService" });

export class PgvectorService {
  private readonly embedder = getEmbeddingService();

  /**
   * Store an embedding in the semantic cache table.
   */
  async storeEmbedding(params: {
    promptHash: string;
    text: string;
    response: string;
    model: string;
    ttlSeconds?: number;
  }): Promise<void> {
    const embedding = await this.embedder.embed(params.text);
    const expiresAt = new Date(Date.now() + (params.ttlSeconds ?? 3600) * 1000);

    // Use raw SQL for pgvector — Prisma doesn't support vector type natively
    await prisma.$executeRaw`
      INSERT INTO semantic_cache (id, prompt_hash, embedding, response, model, token_count, expires_at, created_at)
      VALUES (
        gen_random_uuid(),
        ${params.promptHash},
        ${JSON.stringify(embedding.vector)}::vector,
        ${params.response},
        ${params.model},
        ${embedding.tokenCount},
        ${expiresAt},
        NOW()
      )
      ON CONFLICT (prompt_hash) DO UPDATE SET
        embedding   = EXCLUDED.embedding,
        response    = EXCLUDED.response,
        hit_count   = semantic_cache.hit_count + 1,
        expires_at  = EXCLUDED.expires_at
    `;

    log.debug({ promptHash: params.promptHash }, "Embedding stored");
  }

  /**
   * Find semantically similar cached entries using cosine distance.
   * Returns results above the similarity threshold, ordered by similarity.
   */
  async findSimilar(params: {
    text: string;
    threshold?: number;
    limit?: number;
  }): Promise<VectorSearchResult[]> {
    const threshold = params.threshold ?? 0.92;
    const limit = params.limit ?? 5;

    const embedding = await this.embedder.embed(params.text);
    const vectorStr = JSON.stringify(embedding.vector);

    // pgvector cosine distance: 1 - cosine_similarity
    // So distance < (1 - threshold) means similarity > threshold
    const maxDistance = 1 - threshold;

    const results = await prisma.$queryRaw<
      Array<{ id: string; prompt_hash: string; response: string; token_count: number; distance: number }>
    >`
      SELECT
        id,
        prompt_hash,
        response,
        token_count,
        (embedding <=> ${vectorStr}::vector) AS distance
      FROM semantic_cache
      WHERE
        expires_at > NOW()
        AND (embedding <=> ${vectorStr}::vector) < ${maxDistance}
      ORDER BY distance ASC
      LIMIT ${limit}
    `;

    // Increment hit count for matched entries
    if (results.length > 0) {
      const ids = results.map((r) => r.id);
      await prisma.$executeRaw`
        UPDATE semantic_cache SET hit_count = hit_count + 1
        WHERE id = ANY(${ids}::text[])
      `;
    }

    return results.map((r) => ({
      id: r.id,
      promptHash: r.prompt_hash,
      response: r.response,
      similarity: Number((1 - r.distance).toFixed(4)),
      tokenCount: r.token_count,
    }));
  }

  /**
   * Delete expired cache entries — run periodically.
   */
  async pruneExpired(): Promise<number> {
    const result = await prisma.$executeRaw`
      DELETE FROM semantic_cache WHERE expires_at < NOW()
    `;
    log.info({ deleted: result }, "Pruned expired cache entries");
    return result;
  }
}

let instance: PgvectorService | null = null;
export function getPgvectorService(): PgvectorService {
  instance ??= new PgvectorService();
  return instance;
}
