/**
 * Queue Manager
 *
 * Central registry for all BullMQ queues.
 * Singleton pattern — one Queue instance per queue name across the process.
 *
 * Why centralize queue creation:
 * - BullMQ Queue instances hold Redis connections — don't create per-request
 * - Consistent job options (retry, backoff, TTL) across all enqueue calls
 * - Single place to add queue-level event listeners for monitoring
 *
 * Architecture:
 * - Queue    : producer-side (enqueue jobs) — used in API routes
 * - Worker   : consumer-side (process jobs) — runs in separate process/thread
 * - QueueEvents : event bus for job lifecycle — used for monitoring
 */


import { Queue, type JobsOptions } from "bullmq";
import { redisQueue } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { registry } from "@/observability/metrics";
import { env } from "@/config/env";
import { QUEUE, type QueueName } from "@/workers/types";

const log = createChildLogger({ module: "QueueManager" });

// ─── Default Job Options ──────────────────────────────────────────────────────

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: env.BULLMQ_MAX_RETRIES,
  backoff: {
    type: "exponential",
    delay: 1_000,   // 1s, 2s, 4s, 8s...
  },
  removeOnComplete: { count: 200, age: 86_400 },  // Keep 200 completed, max 24h
  removeOnFail:     { count: 100, age: 604_800 },  // Keep 100 failed, max 7d
};

// Per-queue overrides
const QUEUE_JOB_OPTIONS: Partial<Record<QueueName, JobsOptions>> = {
  [QUEUE.BATCH_OPTIMIZATION]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 2,          // Expensive — fewer retries
    backoff: { type: "exponential", delay: 5_000 },
  },
  [QUEUE.ANALYTICS_AGGREGATION]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 5,          // Analytics can retry more — idempotent
  },
  [QUEUE.CLEANUP]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 3,
    removeOnComplete: { count: 50 },
  },
  [QUEUE.DEAD_LETTER]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 1,          // DLQ jobs don't retry
    removeOnFail: { count: 500, age: 2_592_000 }, // Keep 30 days
  },
};

// ─── Queue Registry ───────────────────────────────────────────────────────────

const queueRegistry = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queueRegistry.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: redisQueue,
    defaultJobOptions: QUEUE_JOB_OPTIONS[name] ?? DEFAULT_JOB_OPTIONS,
  });

  queue.on("error", (error) => {
    log.error({ queue: name, err: error }, "Queue error");
    registry.inc("queue_failures_total", { queue: name });
  });

  queueRegistry.set(name, queue);
  log.info({ queue: name }, "Queue initialized");

  return queue;
}

// ─── Typed Enqueue Helpers ────────────────────────────────────────────────────

export async function enqueue<T extends object>(
  queueName: QueueName,
  jobName: string,
  data: T,
  options?: JobsOptions,
): Promise<string> {
  const queue = getQueue(queueName);
  const job = await queue.add(jobName, data, options);

  registry.inc("queue_jobs_total", { queue: queueName, job: jobName });
  log.debug({ queue: queueName, job: jobName, jobId: job.id }, "Job enqueued");

  return job.id ?? "";
}

/**
 * Enqueue with deduplication — skip if identical job already pending.
 * Uses jobId as dedup key.
 */
export async function enqueueUnique<T extends object>(
  queueName: QueueName,
  jobName: string,
  data: T,
  dedupeKey: string,
  options?: JobsOptions,
): Promise<string> {
  return enqueue(queueName, jobName, data, {
    ...options,
    jobId: dedupeKey,
  });
}

/**
 * Schedule a recurring job (cron).
 */
export async function scheduleRecurring(
  queueName: QueueName,
  jobName: string,
  data: object,
  cronExpression: string,
): Promise<void> {
  const queue = getQueue(queueName);
  await queue.upsertJobScheduler(
    `${queueName}:${jobName}:cron`,
    { pattern: cronExpression },
    { name: jobName, data },
  );
  log.info({ queue: queueName, job: jobName, cron: cronExpression }, "Recurring job scheduled");
}

// ─── Queue Stats ──────────────────────────────────────────────────────────────

export async function getQueueStats(queueName: QueueName) {
  const queue = getQueue(queueName);
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  const depth = waiting + active + delayed;
  registry.set("queue_depth", depth, { queue: queueName });

  return { waiting, active, completed, failed, delayed, depth };
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  await Promise.all([...queueRegistry.values()].map((q) => q.close()));
  queueRegistry.clear();
  log.info("All queues closed");
}
