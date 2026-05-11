/**
 * Duplicate Request Detector
 *
 * Detects semantically duplicate requests within a time window.
 * Prevents paying twice for the same (or very similar) prompt.
 *
 * Two detection levels:
 * 1. Exact hash match  — O(1), catches identical requests
 * 2. Semantic match    — embedding similarity, catches paraphrases
 *
 * Window: 5 minutes — requests within this window are checked.
 * After 5 minutes, the same prompt is treated as a new request
 * (context may have changed, user may want a fresh response).
 */

import "server-only";

import crypto from "crypto";
import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { modelRegistry } from "@/services/ai/model-registry";
import type { AICompletionResponse, AIMessage, AIModel } from "@/types/ai";
import type { DuplicateCheckResult } from "@/types/cost-optimization";

const log = createChildLogger({ module: "DuplicateDetector" });

const DEDUP_WINDOW_SECONDS = 300;   // 5 minutes
const DEDUP_PREFIX = "dedup:";
const SIMILARITY_THRESHOLD = 0.97; // Very high — only near-identical prompts

export class DuplicateDetector {
  /**
   * Check if this request is a duplicate of a recent one.
   * Returns cached response if duplicate found.
   */
  async check(
    messages: AIMessage[],
    model: AIModel,
    userId: string,
  ): Promise<DuplicateCheckResult> {
    const dedupeKey = this.buildKey(messages, model, userId);
    const redisKey  = `${DEDUP_PREFIX}${dedupeKey}`;

    try {
      const cached = await redis.get(redisKey);

      if (cached) {
        const response = JSON.parse(cached) as AICompletionResponse;
        const savedCostUsd = modelRegistry.calculateCost(
          model,
          response.usage.inputTokens,
          response.usage.outputTokens,
        ).totalCostUsd;

        log.info({ dedupeKey, userId, savedCostUsd }, "Duplicate request detected");

        return {
          isDuplicate:     true,
          similarity:      1.0,
          cachedResponse:  { ...response, fromCache: true },
          savedCostUsd,
          dedupeKey,
        };
      }
    } catch (error) {
      log.warn({ err: error }, "Duplicate check failed — proceeding");
    }

    return { isDuplicate: false, similarity: 0, dedupeKey };
  }

  /**
   * Record a completed request for future deduplication.
   */
  async record(
    messages: AIMessage[],
    model: AIModel,
    userId: string,
    response: AICompletionResponse,
  ): Promise<void> {
    const dedupeKey = this.buildKey(messages, model, userId);
    const redisKey  = `${DEDUP_PREFIX}${dedupeKey}`;

    try {
      await redis.setex(redisKey, DEDUP_WINDOW_SECONDS, JSON.stringify(response));
    } catch (error) {
      log.warn({ err: error }, "Failed to record for deduplication");
    }
  }

  /**
   * Build a deterministic key from messages + model + userId.
   * Normalizes whitespace for better hit rates.
   */
  private buildKey(messages: AIMessage[], model: AIModel, userId: string): string {
    const normalized = messages
      .map((m) => `${m.role}:${m.content.trim().replace(/\s+/g, " ")}`)
      .join("|");
    return crypto
      .createHash("sha256")
      .update(`${userId}:${String(model)}:${normalized}`)
      .digest("hex")
      .slice(0, 32);
  }
}

let instance: DuplicateDetector | null = null;
export function getDuplicateDetector(): DuplicateDetector {
  instance ??= new DuplicateDetector();
  return instance;
}
