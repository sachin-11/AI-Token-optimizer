/**
 * Cleanup Worker
 *
 * Housekeeping jobs that run on a schedule:
 * - Purge expired semantic cache entries from pgvector
 * - Hard-delete soft-deleted records older than retention period
 * - Remove old completed/failed BullMQ jobs
 */


import { type Job } from "bullmq";
import { BaseWorker } from "@/workers/base-worker";
import {
  QUEUE, JOB,
  type PurgeExpiredCachePayload,
  type SoftDeleteCleanupPayload,
  type CleanupJobResult,
  type JobResult,
} from "@/workers/types";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "CleanupWorker" });

export class CleanupWorker extends BaseWorker<
  PurgeExpiredCachePayload | SoftDeleteCleanupPayload,
  JobResult<CleanupJobResult>
> {
  constructor() {
    super(QUEUE.CLEANUP, 1); // Single concurrency — cleanup is low priority
  }

  protected async processJob(
    job: Job<PurgeExpiredCachePayload | SoftDeleteCleanupPayload>,
  ): Promise<JobResult<CleanupJobResult>> {
    switch (job.name) {
      case JOB.PURGE_EXPIRED_CACHE:
        return this.purgeExpiredCache(job as Job<PurgeExpiredCachePayload>);
      case JOB.SOFT_DELETE_CLEANUP:
        return this.softDeleteCleanup(job as Job<SoftDeleteCleanupPayload>);
      case JOB.PURGE_OLD_JOBS:
        return this.purgeOldJobs();
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  private async purgeExpiredCache(
    job: Job<PurgeExpiredCachePayload>,
  ): Promise<JobResult<CleanupJobResult>> {
    const start = Date.now();
    const { getPgvectorService } = await import("@/services/semantic/pgvector.service");
    const deleted = await getPgvectorService().pruneExpired();

    log.info({ deleted }, "Expired cache entries purged");
    await job.updateProgress(100);

    return {
      success:    true,
      durationMs: Date.now() - start,
      data:       { deletedCount: deleted, table: "semantic_cache" },
    };
  }

  private async softDeleteCleanup(
    job: Job<SoftDeleteCleanupPayload>,
  ): Promise<JobResult<CleanupJobResult>> {
    const start = Date.now();
    const { olderThanDays, tables } = job.data;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const { prisma } = await import("@/lib/prisma");
    let totalDeleted = 0;

    for (const table of tables) {
      let deleted = 0;

      if (table === "prompt_history") {
        const result = await prisma.promptHistory.deleteMany({
          where: { deletedAt: { not: null, lte: cutoff } },
        });
        deleted = result.count;
      } else if (table === "optimization_results") {
        const result = await prisma.optimizationResult.deleteMany({
          where: { deletedAt: { not: null, lte: cutoff } },
        });
        deleted = result.count;
      } else if (table === "users") {
        const result = await prisma.user.deleteMany({
          where: { deletedAt: { not: null, lte: cutoff } },
        });
        deleted = result.count;
      }

      log.info({ table, deleted, cutoff }, "Soft-deleted records purged");
      totalDeleted += deleted;
    }

    return {
      success:    true,
      durationMs: Date.now() - start,
      data:       { deletedCount: totalDeleted, table: tables.join(",") },
    };
  }

  private async purgeOldJobs(): Promise<JobResult<CleanupJobResult>> {
    const start = Date.now();
    const { getQueue } = await import("@/workers/queue-manager");
    const { QUEUE: Q } = await import("@/workers/types");

    let totalCleaned = 0;
    for (const queueName of Object.values(Q)) {
      try {
        const queue = getQueue(queueName);
        await queue.clean(86_400_000, 100, "completed"); // 24h old completed
        await queue.clean(604_800_000, 50, "failed");    // 7d old failed
        totalCleaned++;
      } catch { /* skip if queue doesn't exist */ }
    }

    return {
      success:    true,
      durationMs: Date.now() - start,
      data:       { deletedCount: totalCleaned, table: "bullmq_jobs" },
    };
  }
}
