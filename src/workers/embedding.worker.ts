/**
 * Embedding Generation Worker
 *
 * Generates and stores vector embeddings asynchronously.
 * Decouples embedding generation from the request path —
 * embeddings are expensive (~20ms + API cost) but not needed synchronously.
 */


import { type Job } from "bullmq";
import { BaseWorker } from "@/workers/base-worker";
import {
  QUEUE, JOB,
  type GenerateEmbeddingPayload,
  type BatchEmbeddingsPayload,
  type EmbeddingJobResult,
  type JobResult,
} from "@/workers/types";
import { createChildLogger } from "@/lib/logger";
import { createConcurrencyLimit } from "@/utils/async";

const log = createChildLogger({ module: "EmbeddingWorker" });

export class EmbeddingWorker extends BaseWorker<
  GenerateEmbeddingPayload | BatchEmbeddingsPayload,
  JobResult<EmbeddingJobResult | EmbeddingJobResult[]>
> {
  constructor() {
    super(QUEUE.EMBEDDING_GENERATION, 5);
  }

  protected async processJob(
    job: Job<GenerateEmbeddingPayload | BatchEmbeddingsPayload>,
  ): Promise<JobResult<EmbeddingJobResult | EmbeddingJobResult[]>> {
    switch (job.name) {
      case JOB.GENERATE_EMBEDDING:
        return this.generateSingle(job as Job<GenerateEmbeddingPayload>);
      case JOB.BATCH_EMBEDDINGS:
        return this.generateBatch(job as Job<BatchEmbeddingsPayload>);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  private async generateSingle(
    job: Job<GenerateEmbeddingPayload>,
  ): Promise<JobResult<EmbeddingJobResult>> {
    const start = Date.now();
    const { text, promptHash, ttlSeconds } = job.data;

    const { getEmbeddingService } = await import("@/services/semantic/embedding.service");
    const embedder = getEmbeddingService();

    // Check if already cached
    const { redis } = await import("@/lib/redis");
    const cacheKey = `emb:${promptHash}`;
    const existing = await redis.exists(cacheKey);

    if (existing) {
      log.debug({ promptHash }, "Embedding already cached — skipping");
      return {
        success: true,
        durationMs: Date.now() - start,
        data: { promptHash, tokenCount: 0, cached: true },
      };
    }

    const embedding = await embedder.embed(text);

    // Store in pgvector for semantic search
    const { getPgvectorService } = await import("@/services/semantic/pgvector.service");
    await getPgvectorService().storeEmbedding({
      promptHash,
      text,
      response: "",  // No response — just storing the embedding
      model:    embedding.model,
      ttlSeconds,
    });

    return {
      success:    true,
      durationMs: Date.now() - start,
      data: { promptHash, tokenCount: embedding.tokenCount, cached: false },
    };
  }

  private async generateBatch(
    job: Job<BatchEmbeddingsPayload>,
  ): Promise<JobResult<EmbeddingJobResult[]>> {
    const start = Date.now();
    const { items } = job.data;

    log.info({ count: items.length }, "Generating batch embeddings");

    const limit = createConcurrencyLimit(5);
    const results: EmbeddingJobResult[] = [];
    let processed = 0;

    await Promise.all(
      items.map((item) =>
        limit(async () => {
          const { getEmbeddingService } = await import("@/services/semantic/embedding.service");
          const embedding = await getEmbeddingService().embed(item.text);
          results.push({ promptHash: item.promptHash, tokenCount: embedding.tokenCount, cached: false });
          processed++;
          await job.updateProgress(Math.round((processed / items.length) * 100));
        }),
      ),
    );

    return { success: true, durationMs: Date.now() - start, data: results };
  }
}
