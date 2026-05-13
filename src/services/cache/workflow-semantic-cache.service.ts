// Workflow Semantic Cache -- ML Layer 1
// Embeds incoming prompts and searches pgvector (HNSW) for cached WorkflowResults
// from semantically similar past optimizations (cosine >= 0.92).
// On a hit the full 4-agent pipeline is skipped (~100ms vs 10-30s).
// Only high-quality results (qualityScore >= 70) are stored to prevent
// propagating bad compressions to similar future prompts.
// See prisma/vector-indexes.sql for the HNSW index setup.

import "server-only";

import { prisma } from "@/lib/prisma";
import { createChildLogger } from "@/lib/logger";
import { getEmbeddingService } from "@/services/semantic/embedding.service";
import { TtlManager } from "@/services/cache/ttl-manager";
import type { WorkflowResult } from "@/types/agent";

const log = createChildLogger({ module: "WorkflowSemanticCache" });

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum cosine similarity to accept a semantic cache hit */
const DEFAULT_THRESHOLD = 0.92;

/**
 * Only store results above this quality score.
 * Prevents low-quality compressions from polluting future similar-prompt lookups.
 */
const MIN_QUALITY_SCORE = 70;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowSemanticHit {
  /** The cached WorkflowResult (caller should set requestId + originalPrompt before returning to client) */
  result: WorkflowResult;
  /** Cosine similarity between incoming prompt and the cached prompt (0-1) */
  similarity: number;
  /** The original prompt that was cached — useful for debug logging */
  cachedOriginalPrompt: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class WorkflowSemanticCacheService {
  private readonly embedder = getEmbeddingService();

  /**
   * Search for a semantically similar cached workflow result.
   *
   * Filters by model AND mode so we only return results produced with the same
   * parameters the current user is requesting. A BALANCED result is NOT a valid
   * substitution for an AGGRESSIVE request.
   *
   * Always returns null on any error — the cache layer must never block the pipeline.
   */
  async findSimilar(params: {
    prompt: string;
    model: string;
    /** "safe" | "balanced" | "aggressive" (lowercase from request body) */
    mode: string;
    threshold?: number;
  }): Promise<WorkflowSemanticHit | null> {
    const threshold = params.threshold ?? DEFAULT_THRESHOLD;
    const maxDistance = 1 - threshold;
    // DB enum values are uppercase (SAFE / BALANCED / AGGRESSIVE)
    const modeDb = params.mode.toUpperCase();

    try {
      const embedding = await this.embedder.embed(params.prompt);
      const vectorStr = JSON.stringify(embedding.vector);

      const rows = await prisma.$queryRaw<
        Array<{ id: string; original_prompt: string; result: string; distance: number }>
      >`
        SELECT
          id,
          original_prompt,
          result::text,
          (embedding <=> ${vectorStr}::vector) AS distance
        FROM workflow_semantic_cache
        WHERE
          model       = ${params.model}
          AND mode::text  = ${modeDb}
          AND expires_at  > NOW()
          AND embedding   IS NOT NULL
          AND (embedding <=> ${vectorStr}::vector) < ${maxDistance}
        ORDER BY distance ASC
        LIMIT 1
      `;

      if (!rows.length || !rows[0]) return null;

      const row = rows[0];
      const similarity = Number((1 - row.distance).toFixed(4));

      let result: WorkflowResult;
      try {
        result = JSON.parse(row.result) as WorkflowResult;
      } catch {
        log.warn({ id: row.id }, "Failed to parse cached WorkflowResult JSON — skipping hit");
        return null;
      }

      // Increment hit count asynchronously — never block the response path
      void prisma.$executeRaw`
        UPDATE workflow_semantic_cache SET hit_count = hit_count + 1 WHERE id = ${row.id}
      `.catch(() => {
        /* non-fatal */
      });

      log.info(
        { similarity, model: params.model, mode: params.mode, threshold },
        "Workflow semantic cache hit",
      );

      return { result, similarity, cachedOriginalPrompt: row.original_prompt };
    } catch (error) {
      // Treat all errors as cache misses — never let cache layer break the pipeline
      log.warn(
        { err: error },
        "Workflow semantic cache lookup failed — falling through to pipeline",
      );
      return null;
    }
  }

  /**
   * Store a completed workflow result in the semantic cache.
   *
   * Called asynchronously after every successful fresh optimization — never on
   * the hot path, so it may take a few hundred ms without impacting the user.
   *
   * Guards:
   * - qualityScore < 70 → skip (don't propagate low-quality results)
   * - finalPrompt === originalPrompt → skip (no compression was applied, nothing to cache)
   */
  async store(params: {
    prompt: string;
    model: string;
    /** "safe" | "balanced" | "aggressive" (lowercase) */
    mode: string;
    result: WorkflowResult;
    ttlSeconds?: number;
  }): Promise<void> {
    const { result } = params;

    if (result.qualityScore < MIN_QUALITY_SCORE) {
      log.debug(
        { qualityScore: result.qualityScore, min: MIN_QUALITY_SCORE },
        "Skipping semantic cache store — quality score below threshold",
      );
      return;
    }

    if (!result.finalPrompt || result.finalPrompt === result.originalPrompt) {
      log.debug("Skipping semantic cache store — compression produced no change");
      return;
    }

    const modeDb = params.mode.toUpperCase();
    const ttl = params.ttlSeconds ?? TtlManager.workflowSemantic(params.model);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const promptHash = this.embedder.hashText(params.prompt);

    try {
      const embedding = await this.embedder.embed(params.prompt);
      const vectorStr = JSON.stringify(embedding.vector);
      const resultJson = JSON.stringify(result);

      await prisma.$executeRaw`
        INSERT INTO workflow_semantic_cache (
          id,
          prompt_hash,
          original_prompt,
          embedding,
          model,
          mode,
          result,
          tokens_saved,
          quality_score,
          hit_count,
          expires_at,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          ${promptHash},
          ${params.prompt},
          ${vectorStr}::vector,
          ${params.model},
          ${modeDb}::"OptimizationMode",
          ${resultJson}::jsonb,
          ${result.tokensSaved},
          ${result.qualityScore},
          0,
          ${expiresAt},
          NOW()
        )
        ON CONFLICT (prompt_hash) DO UPDATE SET
          embedding     = EXCLUDED.embedding,
          result        = EXCLUDED.result,
          tokens_saved  = EXCLUDED.tokens_saved,
          quality_score = EXCLUDED.quality_score,
          expires_at    = EXCLUDED.expires_at
      `;

      log.debug(
        { promptHash, model: params.model, mode: params.mode, ttlSeconds: ttl },
        "Workflow result stored in semantic cache",
      );
    } catch (error) {
      // Non-fatal — user already has their result
      log.warn({ err: error }, "Workflow semantic cache store failed — non-fatal");
    }
  }

  /**
   * Delete all expired entries from the table.
   * Wire this into a periodic BullMQ job to keep the table lean.
   */
  async pruneExpired(): Promise<number> {
    try {
      const deleted = await prisma.$executeRaw`
        DELETE FROM workflow_semantic_cache WHERE expires_at < NOW()
      `;
      const count = Number(deleted);
      log.info({ deleted: count }, "Pruned expired workflow semantic cache entries");
      return count;
    } catch (error) {
      log.warn({ err: error }, "Workflow semantic cache prune failed — non-fatal");
      return 0;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: WorkflowSemanticCacheService | null = null;
export function getWorkflowSemanticCache(): WorkflowSemanticCacheService {
  instance ??= new WorkflowSemanticCacheService();
  return instance;
}
