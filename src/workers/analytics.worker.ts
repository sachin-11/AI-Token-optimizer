/**
 * Analytics Aggregation Worker
 *
 * Runs daily aggregation jobs to roll up token usage and cost data.
 * Idempotent — safe to re-run for the same date (upsert pattern).
 */


import { type Job } from "bullmq";
import { BaseWorker } from "@/workers/base-worker";
import {
  QUEUE, JOB,
  type AggregateUsagePayload,
  type ComputeCostReportPayload,
  type AggregationJobResult,
  type JobResult,
} from "@/workers/types";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "AnalyticsWorker" });

export class AnalyticsWorker extends BaseWorker<
  AggregateUsagePayload | ComputeCostReportPayload,
  JobResult<AggregationJobResult>
> {
  constructor() {
    super(QUEUE.ANALYTICS_AGGREGATION, 2);
  }

  protected async processJob(
    job: Job<AggregateUsagePayload | ComputeCostReportPayload>,
  ): Promise<JobResult<AggregationJobResult>> {
    switch (job.name) {
      case JOB.AGGREGATE_DAILY_USAGE:
        return this.aggregateDailyUsage(job as Job<AggregateUsagePayload>);
      case JOB.COMPUTE_COST_REPORT:
        return this.computeCostReport(job as Job<ComputeCostReportPayload>);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  private async aggregateDailyUsage(
    job: Job<AggregateUsagePayload>,
  ): Promise<JobResult<AggregationJobResult>> {
    const start = Date.now();
    const { date, userId } = job.data;

    log.info({ date, userId: userId ?? "all" }, "Aggregating daily usage");

    const { prisma } = await import("@/lib/prisma");

    // Get all optimization results for the date
    const targetDate = new Date(date);
    const nextDate   = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const where = {
      createdAt: { gte: targetDate, lt: nextDate },
      status:    "COMPLETED" as const,
      ...(userId && { userId }),
    };

    const results = await prisma.optimizationResult.findMany({
      where,
      select: {
        userId:          true,
        provider:        true,
        model:           true,
        inputTokens:     true,
        outputTokens:    true,
        estimatedCostUsd: true,
        fromCache:       true,
      },
    });

    await job.updateProgress(50);

    // Group by userId + provider + model and upsert
    const grouped = new Map<string, {
      userId: string; provider: string; model: string;
      inputTokens: number; outputTokens: number; costUsd: number; cacheHits: number; requests: number;
    }>();

    for (const r of results) {
      const key = `${r.userId}:${r.provider}:${r.model}`;
      const existing = grouped.get(key) ?? {
        userId: r.userId, provider: r.provider, model: r.model,
        inputTokens: 0, outputTokens: 0, costUsd: 0, cacheHits: 0, requests: 0,
      };
      existing.inputTokens  += r.inputTokens  ?? 0;
      existing.outputTokens += r.outputTokens ?? 0;
      existing.costUsd      += r.estimatedCostUsd ?? 0;
      existing.cacheHits    += r.fromCache ? 1 : 0;
      existing.requests     += 1;
      grouped.set(key, existing);
    }

    let recordsCreated = 0;
    for (const stat of grouped.values()) {
      await prisma.usageStat.upsert({
        where: {
          userId_date_provider_model: {
            userId:   stat.userId,
            date:     targetDate,
            provider: stat.provider as "OPENAI" | "ANTHROPIC" | "GEMINI",
            model:    stat.model,
          },
        },
        update: {
          totalRequests:     { increment: stat.requests },
          totalInputTokens:  { increment: stat.inputTokens },
          totalOutputTokens: { increment: stat.outputTokens },
          totalCostUsd:      { increment: stat.costUsd },
          cacheHits:         { increment: stat.cacheHits },
        },
        create: {
          userId:            stat.userId,
          date:              targetDate,
          provider:          stat.provider as "OPENAI" | "ANTHROPIC" | "GEMINI",
          model:             stat.model,
          totalRequests:     stat.requests,
          totalInputTokens:  stat.inputTokens,
          totalOutputTokens: stat.outputTokens,
          totalCostUsd:      stat.costUsd,
          cacheHits:         stat.cacheHits,
        },
      });
      recordsCreated++;
    }

    await job.updateProgress(100);

    return {
      success:    true,
      durationMs: Date.now() - start,
      data: { date, usersProcessed: grouped.size, recordsCreated },
    };
  }

  private async computeCostReport(
    job: Job<ComputeCostReportPayload>,
  ): Promise<JobResult<AggregationJobResult>> {
    const start = Date.now();
    const { userId, startDate, endDate } = job.data;

    log.info({ userId, startDate, endDate }, "Computing cost report");

    const { prisma } = await import("@/lib/prisma");

    const stats = await prisma.usageStat.aggregate({
      where: {
        userId,
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      _sum: { totalCostUsd: true, totalInputTokens: true, totalOutputTokens: true },
      _count: { id: true },
    });

    log.info(
      {
        userId,
        totalCost:   stats._sum.totalCostUsd,
        totalTokens: (stats._sum.totalInputTokens ?? 0) + (stats._sum.totalOutputTokens ?? 0),
        requests:    stats._count.id,
      },
      "Cost report computed",
    );

    return {
      success:    true,
      durationMs: Date.now() - start,
      data: { date: startDate, usersProcessed: 1, recordsCreated: 0 },
    };
  }
}
