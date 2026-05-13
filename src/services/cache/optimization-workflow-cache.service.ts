/**
 * Optimization workflow cache — exact match on prompt + model + mode (+ targetTokens).
 * Order: Redis → (miss) PostgreSQL → (miss) run pipeline, then back-fill Redis + DB.
 */

import "server-only";

import type { OptimizationResult as OptimizationRow } from "@prisma/client";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { CacheKeyFactory } from "@/services/cache/cache-key.factory";
import { TtlManager } from "@/services/cache/ttl-manager";
import { WorkflowStatus, type WorkflowResult } from "@/types/agent";

const log = createChildLogger({ module: "OptimizationWorkflowCache" });

export type OptimizationCacheSource = "redis" | "database";

export interface CachedWorkflowLookup {
  result: WorkflowResult;
  source: OptimizationCacheSource;
}

function redisKey(inputHash: string): string {
  return CacheKeyFactory.optimizationWorkflow(inputHash);
}

export function optimizationRowToWorkflowResult(row: OptimizationRow): WorkflowResult {
  const status =
    row.status === "COMPLETED"
      ? WorkflowStatus.COMPLETED
      : row.status === "FAILED"
        ? WorkflowStatus.FAILED
        : WorkflowStatus.COMPLETED;

  return {
    requestId:       row.requestId,
    status,
    originalPrompt:  row.originalPrompt,
    finalPrompt:     row.optimizedPrompt ?? row.originalPrompt,
    tokensSaved:     row.savedTokens ?? 0,
    compressionRatio: row.compressionRatio ?? 1,
    costSavingsUsd:  row.savedCostUsd ?? 0,
    qualityScore:    row.qualityScore ?? 0,
    agentTrace:      (row.agentTrace as WorkflowResult["agentTrace"]) ?? [],
    streamEvents:    [],
    durationMs:      row.processingTimeMs ?? 0,
  };
}

export class OptimizationWorkflowCacheService {
  async getFromRedis(inputHash: string): Promise<WorkflowResult | null> {
    const key = redisKey(inputHash);
    try {
      const raw = await redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WorkflowResult;
      if (!parsed?.finalPrompt || typeof parsed.requestId !== "string") return null;
      log.debug({ inputHash: inputHash.slice(0, 16) }, "Optimization workflow cache hit (Redis)");
      return parsed;
    } catch (error) {
      log.warn({ err: error }, "Redis optimization cache read failed");
      return null;
    }
  }

  async setRedis(inputHash: string, model: string, result: WorkflowResult): Promise<void> {
    const key = redisKey(inputHash);
    const ttl = TtlManager.optimizationWorkflow(model);
    try {
      await redis.setex(key, ttl, JSON.stringify(result));
      log.debug({ inputHash: inputHash.slice(0, 16), ttl }, "Optimization workflow cache set (Redis)");
    } catch (error) {
      log.warn({ err: error }, "Redis optimization cache write failed — non-fatal");
    }
  }
}

let instance: OptimizationWorkflowCacheService | null = null;

export function getOptimizationWorkflowCache(): OptimizationWorkflowCacheService {
  instance ??= new OptimizationWorkflowCacheService();
  return instance;
}
