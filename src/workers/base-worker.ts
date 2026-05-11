/**
 * Base Worker
 *
 * Abstract base class for all BullMQ workers.
 * Provides:
 * - Structured logging per job
 * - Automatic metrics recording
 * - Dead-letter queue routing on final failure
 * - Graceful shutdown handling
 * - Error classification (retryable vs permanent)
 *
 * Why abstract base:
 * - Every worker needs the same lifecycle hooks
 * - DRY: job timing, error handling, DLQ routing are identical
 * - Each concrete worker only implements processJob()
 */


import { Worker, type Job, type WorkerOptions } from "bullmq";
import { redisQueue } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { registry } from "@/observability/metrics";
import { startTimer } from "@/observability/monitoring";
import { enqueue } from "@/workers/queue-manager";
import { env } from "@/config/env";
import { QUEUE, type QueueName, type DeadLetterPayload } from "@/workers/types";

// ─── Abstract Base ────────────────────────────────────────────────────────────

export abstract class BaseWorker<TData = unknown, TResult = unknown> {
  protected readonly log;
  private worker: Worker<TData, TResult> | null = null;

  constructor(
    protected readonly queueName: QueueName,
    protected readonly concurrency: number = env.BULLMQ_CONCURRENCY,
  ) {
    this.log = createChildLogger({ module: `Worker:${queueName}` });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.worker) return;

    const options: WorkerOptions = {
      connection:  redisQueue,
      concurrency: this.concurrency,
      // Stalled job detection — reclaim jobs that crashed mid-processing
      stalledInterval: 30_000,
      maxStalledCount: 2,
    };

    this.worker = new Worker<TData, TResult>(
      this.queueName,
      async (job) => this.handleJob(job),
      options,
    );

    this.worker.on("completed", (job, result) => {
      this.log.info({ jobId: job.id, jobName: job.name }, "job:completed");
      registry.inc("queue_jobs_total", { queue: this.queueName, status: "completed" });
    });

    this.worker.on("failed", (job, error) => {
      const isLastAttempt = (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 1);
      this.log.error(
        { jobId: job?.id, jobName: job?.name, attempt: job?.attemptsMade, err: error },
        isLastAttempt ? "job:dead" : "job:failed",
      );
      registry.inc("queue_failures_total", { queue: this.queueName, job: job?.name ?? "unknown" });
    });

    this.worker.on("stalled", (jobId) => {
      this.log.warn({ jobId }, "job:stalled");
    });

    this.worker.on("error", (error) => {
      this.log.error({ err: error }, "worker:error");
    });

    this.log.info({ concurrency: this.concurrency }, "Worker started");
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    await this.worker.close();
    this.worker = null;
    this.log.info("Worker stopped");
  }

  // ─── Job Handler ────────────────────────────────────────────────────────────

  private async handleJob(job: Job<TData, TResult>): Promise<TResult> {
    const timer = startTimer();

    this.log.info(
      { jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1 },
      "job:start",
    );

    try {
      const result = await this.processJob(job);
      const durationMs = timer.end();

      this.log.info(
        { jobId: job.id, jobName: job.name, durationMs },
        "job:success",
      );

      return result;
    } catch (error) {
      const durationMs = timer.end();
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      this.log.error(
        { jobId: job.id, jobName: job.name, durationMs, attempt: job.attemptsMade + 1, err: error },
        "job:error",
      );

      // Route to DLQ on final failure
      if (isLastAttempt) {
        await this.sendToDeadLetter(job, error);
      }

      throw error;
    }
  }

  // ─── Dead Letter Queue ───────────────────────────────────────────────────────

  private async sendToDeadLetter(job: Job<TData>, error: unknown): Promise<void> {
    try {
      const payload: DeadLetterPayload = {
        originalQueue:   this.queueName,
        originalJobName: job.name,
        originalJobId:   job.id ?? "",
        originalData:    job.data,
        failureReason:   error instanceof Error ? error.message : String(error),
        attemptsMade:    job.attemptsMade,
        failedAt:        new Date().toISOString(),
      };

      await enqueue(QUEUE.DEAD_LETTER, "dead-letter-process", payload);
      this.log.warn({ jobId: job.id, jobName: job.name }, "job:sent-to-dlq");
    } catch (dlqError) {
      this.log.error({ err: dlqError }, "Failed to send job to DLQ");
    }
  }

  // ─── Abstract ───────────────────────────────────────────────────────────────

  protected abstract processJob(job: Job<TData, TResult>): Promise<TResult>;
}
