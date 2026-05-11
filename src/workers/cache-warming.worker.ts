/**
 * Cache Warming Worker
 *
 * Pre-populates the semantic cache with embeddings for frequently used prompts.
 * Runs on a schedule (nightly) to ensure cache is warm before peak hours.
 *
 * Strategy:
 * 1. Query top N most-optimized prompts from DB
 * 2. Generate embeddings for any not already cached
 * 3. Store in Redis + pgvector
 */


import { type Job } from "bullmq";
import { BaseWorker } from "@/workers/base-worker";
import {
  QUEUE, JOB,
  type WarmCachePayload,
  type JobResult,
} from "@/workers/types";
import { createChildLogger } from "@/lib/logger";
import { createConcurrencyLimit } from "@/utils/async";

const log = createChildLogger({ module: "CacheWarmingWorker" });

export class CacheWarmingWorker extends BaseWorker<WarmCachePayload, JobResult<{ warmed: number; skipped: number }>> {
  constructor() {
    super(QUEUE.CACHE_WARMING, 2);
  }

  protected async processJob(
    job: Job<WarmCachePayload>,
  ): Promise<JobResult<{ warmed: number; skipped: number }>> {
    switch (job.name) {
      case JOB.WARM_SEMANTIC_CACHE:
        return this.warmSemanticCache(job);
      case JOB.WARM_EMBEDDING_CACHE:
        return this.warmEmbeddingCache(job);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  private async warmSemanticCache(
    job: Job<WarmCachePayload>,
  ): Promise<JobResult<{ warmed: number; skipped: number }>> {
    const start = Date.now();
    const { topN, userId } = job.data;

    log.info({ topN, userId: userId ?? "all" }, "Warming semantic cache");

    const { prisma } = await import("@/lib/prisma");

    // Get most frequently optimized prompts
    const topPrompts = await prisma.optimizationResult.findMany({
      where: {
        status: "COMPLETED",
        ...(userId && { userId }),
      },
      orderBy: { createdAt: "desc" },
      take: topN,
      select: { originalPrompt: true, model: true },
      distinct: ["originalPrompt"],
    });

    await job.updateProgress(20);

    const { getEmbeddingService } = await import("@/services/semantic/embedding.service");
    const { getPgvectorService }  = await import("@/services/semantic/pgvector.service");
    const embedder   = getEmbeddingService();
    const pgvector   = getPgvectorService();
    const limit      = createConcurrencyLimit(3);

    let warmed = 0;
    let skipped = 0;

    await Promise.all(
      topPrompts.map((p) =>
        limit(async () => {
          const promptHash = embedder.hashText(p.originalPrompt);
          const { redis } = await import("@/lib/redis");
          const exists = await redis.exists(`emb:${promptHash}`);

          if (exists) {
            skipped++;
            return;
          }

          try {
            const embedding = await embedder.embed(p.originalPrompt);
            await pgvector.storeEmbedding({
              promptHash,
              text:      p.originalPrompt,
              response:  "",
              model:     p.model,
              ttlSeconds: 86_400,
            });
            warmed++;
          } catch (error) {
            log.warn({ promptHash, err: error }, "Failed to warm cache entry");
          }

          const progress = Math.round(((warmed + skipped) / topPrompts.length) * 80) + 20;
          await job.updateProgress(progress);
        }),
      ),
    );

    await job.updateProgress(100);
    log.info({ warmed, skipped }, "Cache warming complete");

    return {
      success:    true,
      durationMs: Date.now() - start,
      data:       { warmed, skipped },
    };
  }

  private async warmEmbeddingCache(
    job: Job<WarmCachePayload>,
  ): Promise<JobResult<{ warmed: number; skipped: number }>> {
    // Similar to semantic cache warming but focuses on Redis embedding cache
    return this.warmSemanticCache(job);
  }
}
