/**
 * Job Scheduler
 *
 * Registers all recurring cron jobs.
 * Called once at startup from instrumentation.ts.
 *
 * Cron schedule:
 * - Analytics aggregation : daily at 01:00 UTC
 * - Cache warming          : daily at 02:00 UTC (after analytics)
 * - Expired cache purge    : daily at 03:00 UTC
 * - Soft delete cleanup    : weekly Sunday at 04:00 UTC
 * - Old job purge          : daily at 05:00 UTC
 */


import { scheduleRecurring } from "@/workers/queue-manager";
import { QUEUE, JOB } from "@/workers/types";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "Scheduler" });

export async function registerScheduledJobs(): Promise<void> {
  log.info("Registering scheduled jobs");

  // Daily analytics aggregation — yesterday's data
  await scheduleRecurring(
    QUEUE.ANALYTICS_AGGREGATION,
    JOB.AGGREGATE_DAILY_USAGE,
    { date: "{{yesterday}}", userId: undefined },
    "0 1 * * *",  // 01:00 UTC daily
  );

  // Daily cache warming — top 100 prompts
  await scheduleRecurring(
    QUEUE.CACHE_WARMING,
    JOB.WARM_SEMANTIC_CACHE,
    { topN: 100 },
    "0 2 * * *",  // 02:00 UTC daily
  );

  // Daily expired cache purge
  await scheduleRecurring(
    QUEUE.CLEANUP,
    JOB.PURGE_EXPIRED_CACHE,
    {},
    "0 3 * * *",  // 03:00 UTC daily
  );

  // Weekly soft-delete cleanup (30-day retention)
  await scheduleRecurring(
    QUEUE.CLEANUP,
    JOB.SOFT_DELETE_CLEANUP,
    { olderThanDays: 30, tables: ["prompt_history", "optimization_results"] },
    "0 4 * * 0",  // 04:00 UTC every Sunday
  );

  // Daily old job purge
  await scheduleRecurring(
    QUEUE.CLEANUP,
    JOB.PURGE_OLD_JOBS,
    {},
    "0 5 * * *",  // 05:00 UTC daily
  );

  log.info("Scheduled jobs registered");
}
