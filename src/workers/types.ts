/**
 * Worker Job Type Definitions
 *
 * All job payloads are strongly typed.
 * Each queue has its own payload type — no `any` in job data.
 */

import type { OptimizationMode } from "@/types/compression";

// ─── Queue Names ──────────────────────────────────────────────────────────────

export const QUEUE = {
  BATCH_OPTIMIZATION:    "batch-optimization",
  ANALYTICS_AGGREGATION: "analytics-aggregation",
  EMBEDDING_GENERATION:  "embedding-generation",
  CACHE_WARMING:         "cache-warming",
  CLEANUP:               "cleanup",
  DEAD_LETTER:           "dead-letter",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

// ─── Job Names (per queue) ────────────────────────────────────────────────────

export const JOB = {
  // Batch optimization
  OPTIMIZE_PROMPT:       "optimize-prompt",
  OPTIMIZE_BATCH:        "optimize-batch",

  // Analytics
  AGGREGATE_DAILY_USAGE: "aggregate-daily-usage",
  AGGREGATE_MODEL_USAGE: "aggregate-model-usage",
  COMPUTE_COST_REPORT:   "compute-cost-report",

  // Embeddings
  GENERATE_EMBEDDING:    "generate-embedding",
  BATCH_EMBEDDINGS:      "batch-embeddings",

  // Cache
  WARM_SEMANTIC_CACHE:   "warm-semantic-cache",
  WARM_EMBEDDING_CACHE:  "warm-embedding-cache",

  // Cleanup
  PURGE_EXPIRED_CACHE:   "purge-expired-cache",
  PURGE_OLD_JOBS:        "purge-old-jobs",
  SOFT_DELETE_CLEANUP:   "soft-delete-cleanup",

  // DLQ
  DEAD_LETTER_PROCESS:   "dead-letter-process",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

// ─── Job Payloads ─────────────────────────────────────────────────────────────

export interface OptimizePromptPayload {
  promptId:   string;
  userId:     string;
  content:    string;
  model:      string;
  mode:       OptimizationMode;
  requestId?: string;
}

export interface OptimizeBatchPayload {
  batchId:  string;
  userId:   string;
  promptIds: string[];
  model:    string;
  mode:     OptimizationMode;
}

export interface AggregateUsagePayload {
  date:    string;   // ISO date string YYYY-MM-DD
  userId?: string;   // undefined = aggregate all users
}

export interface ComputeCostReportPayload {
  userId:    string;
  startDate: string;
  endDate:   string;
}

export interface GenerateEmbeddingPayload {
  text:       string;
  promptHash: string;
  model?:     string;
  ttlSeconds?: number;
}

export interface BatchEmbeddingsPayload {
  items: Array<{ text: string; promptHash: string }>;
  model?: string;
}

export interface WarmCachePayload {
  topN:   number;   // Warm top N most-used prompts
  userId?: string;  // undefined = warm for all users
}

export interface PurgeExpiredCachePayload {
  olderThanDays?: number;
}

export interface SoftDeleteCleanupPayload {
  olderThanDays: number;   // Delete soft-deleted records older than N days
  tables: Array<"users" | "prompt_history" | "optimization_results">;
}

export interface DeadLetterPayload {
  originalQueue:   string;
  originalJobName: string;
  originalJobId:   string;
  originalData:    unknown;
  failureReason:   string;
  attemptsMade:    number;
  failedAt:        string;
}

// ─── Job Result Types ─────────────────────────────────────────────────────────

export interface JobResult<T = unknown> {
  success:     boolean;
  durationMs:  number;
  data?:       T;
  error?:      string;
}

export interface OptimizationJobResult {
  promptId:         string;
  originalTokens:   number;
  optimizedTokens:  number;
  compressionRatio: number;
  qualityScore:     number;
}

export interface AggregationJobResult {
  date:          string;
  usersProcessed: number;
  recordsCreated: number;
}

export interface EmbeddingJobResult {
  promptHash:  string;
  tokenCount:  number;
  cached:      boolean;
}

export interface CleanupJobResult {
  deletedCount: number;
  table:        string;
}
