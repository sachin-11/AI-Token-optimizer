/**
 * Dead Letter Queue Worker
 *
 * Processes jobs that exhausted all retry attempts.
 * Actions:
 * 1. Log with full context for alerting
 * 2. Store in DB for manual review
 * 3. Notify (webhook/email) for critical failures
 * 4. Optionally retry with modified parameters
 */


import { type Job } from "bullmq";
import { Worker } from "bullmq";
import { redisQueue } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { registry } from "@/observability/metrics";
import { QUEUE, type DeadLetterPayload } from "@/workers/types";

const log = createChildLogger({ module: "DeadLetterWorker" });

// ─── Critical queues that need immediate alerting ─────────────────────────────

const CRITICAL_QUEUES = new Set([
  QUEUE.BATCH_OPTIMIZATION,
  QUEUE.ANALYTICS_AGGREGATION,
]);

export class DeadLetterWorker {
  private worker: Worker<DeadLetterPayload> | null = null;

  start(): void {
    if (this.worker) return;

    this.worker = new Worker<DeadLetterPayload>(
      QUEUE.DEAD_LETTER,
      async (job) => this.process(job),
      { connection: redisQueue, concurrency: 1 },
    );

    this.worker.on("error", (err) => log.error({ err }, "DLQ worker error"));
    log.info("Dead letter worker started");
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  private async process(job: Job<DeadLetterPayload>): Promise<void> {
    const { originalQueue, originalJobName, originalJobId, failureReason, attemptsMade, failedAt } = job.data;

    // Always log dead letter jobs at error level
    log.error(
      {
        originalQueue,
        originalJobName,
        originalJobId,
        failureReason,
        attemptsMade,
        failedAt,
        data: job.data.originalData,
      },
      "💀 Dead letter job received",
    );

    registry.inc("queue_failures_total", {
      queue:  originalQueue,
      job:    originalJobName,
      status: "dead",
    });

    // Alert for critical queues
    if (CRITICAL_QUEUES.has(originalQueue as typeof QUEUE[keyof typeof QUEUE])) {
      await this.sendAlert(job.data);
    }

    // Store in DB for manual review
    await this.persistToDb(job.data);
  }

  private async sendAlert(payload: DeadLetterPayload): Promise<void> {
    // In production: send to Slack/PagerDuty/email
    // For now: structured log at fatal level (triggers alerting rules)
    log.fatal(
      {
        alert:         "dead-letter-critical",
        originalQueue: payload.originalQueue,
        jobName:       payload.originalJobName,
        reason:        payload.failureReason,
      },
      "🚨 Critical job failed permanently",
    );
  }

  private async persistToDb(payload: DeadLetterPayload): Promise<void> {
    try {
      // Store as a failed optimization result if it's an optimization job
      if (payload.originalQueue === QUEUE.BATCH_OPTIMIZATION) {
        const data = payload.originalData as { requestId?: string };
        if (data.requestId) {
          const { prisma } = await import("@/lib/prisma");
          await prisma.optimizationResult.updateMany({
            where: { requestId: data.requestId },
            data: {
              status:       "FAILED",
              errorMessage: payload.failureReason,
              retryCount:   payload.attemptsMade,
            },
          });
        }
      }
    } catch (error) {
      log.error({ err: error }, "Failed to persist DLQ entry to DB");
    }
  }
}
