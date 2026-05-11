/**
 * Optimization Worker
 *
 * Processes async prompt optimization jobs.
 * Used when the client doesn't need real-time streaming —
 * e.g. batch processing, scheduled optimization, API-key clients.
 */


import { type Job } from "bullmq";
import { BaseWorker } from "@/workers/base-worker";
import { QUEUE, JOB, type OptimizePromptPayload, type OptimizeBatchPayload, type OptimizationJobResult, type JobResult } from "@/workers/types";
import { createChildLogger } from "@/lib/logger";
import { createConcurrencyLimit } from "@/utils/async";

const log = createChildLogger({ module: "OptimizationWorker" });

// ─── Single Prompt Worker ─────────────────────────────────────────────────────

export class OptimizationWorker extends BaseWorker<
  OptimizePromptPayload | OptimizeBatchPayload,
  JobResult<OptimizationJobResult | OptimizationJobResult[]>
> {
  constructor() {
    super(QUEUE.BATCH_OPTIMIZATION, 3); // Lower concurrency — AI calls are expensive
  }

  protected async processJob(
    job: Job<OptimizePromptPayload | OptimizeBatchPayload>,
  ): Promise<JobResult<OptimizationJobResult | OptimizationJobResult[]>> {
    const start = Date.now();

    switch (job.name) {
      case JOB.OPTIMIZE_PROMPT:
        return this.optimizeSingle(job as Job<OptimizePromptPayload>);
      case JOB.OPTIMIZE_BATCH:
        return this.optimizeBatch(job as Job<OptimizeBatchPayload>);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  private async optimizeSingle(
    job: Job<OptimizePromptPayload>,
  ): Promise<JobResult<OptimizationJobResult>> {
    const start = Date.now();
    const { promptId, userId, content, model, mode, requestId } = job.data;

    log.info({ promptId, userId, model, mode }, "Optimizing single prompt");

    // Update job progress
    await job.updateProgress(10);

    const { getWorkflowOrchestrator } = await import("@/agents/graph/workflow-orchestrator");
    const orchestrator = getWorkflowOrchestrator();

    await job.updateProgress(20);

    const result = await orchestrator.run({
      prompt: content,
      model,
      mode,
      userId,
      requestId,
    });

    await job.updateProgress(90);

    // Persist result to DB
    const { OptimizationResultService } = await import("@/services/db/optimization-result.service");
    if (result.status === "completed") {
      await OptimizationResultService.updateByRequestId(result.requestId, {
        status:          "COMPLETED",
        optimizedPrompt: result.finalPrompt,
        savedTokens:     result.tokensSaved,
        compressionRatio: result.compressionRatio,
        savedCostUsd:    result.costSavingsUsd,
        qualityScore:    result.qualityScore,
        processingTimeMs: result.durationMs,
      });
    }

    await job.updateProgress(100);

    return {
      success:    result.status === "completed",
      durationMs: Date.now() - start,
      data: {
        promptId,
        originalTokens:   result.tokensSaved + Math.round(result.tokensSaved / Math.max(0.01, 1 - result.compressionRatio)),
        optimizedTokens:  Math.round(result.tokensSaved / Math.max(0.01, 1 - result.compressionRatio)),
        compressionRatio: result.compressionRatio,
        qualityScore:     result.qualityScore,
      },
    };
  }

  private async optimizeBatch(
    job: Job<OptimizeBatchPayload>,
  ): Promise<JobResult<OptimizationJobResult[]>> {
    const start = Date.now();
    const { batchId, userId, promptIds, model, mode } = job.data;

    log.info({ batchId, userId, count: promptIds.length }, "Processing batch optimization");

    const { getPromptHistoryRepository } = await import("@/repositories/prompt-history.repository");
    const repo = getPromptHistoryRepository();

    // Process with concurrency limit — don't hammer the AI provider
    const limit = createConcurrencyLimit(2);
    const results: OptimizationJobResult[] = [];
    let processed = 0;

    await Promise.all(
      promptIds.map((promptId) =>
        limit(async () => {
          const prompt = await repo.findById(promptId, userId);
          if (!prompt) return;

          const { getWorkflowOrchestrator } = await import("@/agents/graph/workflow-orchestrator");
          const result = await getWorkflowOrchestrator().run({
            prompt: prompt.originalContent,
            model,
            mode,
            userId,
          });

          results.push({
            promptId,
            originalTokens:   result.tokensSaved + 100,
            optimizedTokens:  100,
            compressionRatio: result.compressionRatio,
            qualityScore:     result.qualityScore,
          });

          processed++;
          await job.updateProgress(Math.round((processed / promptIds.length) * 100));
        }),
      ),
    );

    return {
      success:    true,
      durationMs: Date.now() - start,
      data:       results,
    };
  }
}
