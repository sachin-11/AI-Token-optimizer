/**
 * AI-Specific Metrics Collector
 *
 * Records token usage, cost, latency, and compression metrics
 * after every AI provider call and optimization workflow.
 *
 * Separation from generic metrics:
 * - AI metrics have domain-specific labels (model, provider, mode)
 * - Token economics need their own aggregation logic
 * - Cost tracking requires model-specific pricing
 */

import "server-only";

import { registry } from "@/observability/metrics";
import { createChildLogger } from "@/lib/logger";
import type { AICompletionResponse } from "@/types/ai";
import type { WorkflowResult } from "@/types/agent";

const log = createChildLogger({ module: "AIMetrics" });

// ─── AI Request Metrics ───────────────────────────────────────────────────────

export function recordAIRequest(params: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  fromCache: boolean;
  success: boolean;
  costUsd?: number;
}): void {
  const labels = { provider: params.provider, model: params.model };

  registry.inc("ai_requests_total", labels);

  if (!params.success) {
    registry.inc("ai_errors_total", labels);
  }

  registry.inc("ai_tokens_total", { ...labels, type: "input" },  params.inputTokens);
  registry.inc("ai_tokens_total", { ...labels, type: "output" }, params.outputTokens);

  registry.observe("ai_latency_ms", params.latencyMs, labels);

  if (params.fromCache) {
    registry.inc("cache_hits_total", labels);
  } else {
    registry.inc("cache_misses_total", labels);
  }

  log.debug(
    { ...params, totalTokens: params.inputTokens + params.outputTokens },
    "AI request recorded",
  );
}

/**
 * Record metrics from an AICompletionResponse directly.
 */
export function recordAIResponse(response: AICompletionResponse): void {
  recordAIRequest({
    provider:     response.provider,
    model:        response.model,
    inputTokens:  response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    latencyMs:    response.latencyMs,
    fromCache:    response.fromCache ?? false,
    success:      true,
    costUsd:      response.cost.totalCostUsd,
  });
}

// ─── Optimization Workflow Metrics ────────────────────────────────────────────

export function recordOptimizationResult(result: WorkflowResult): void {
  const labels = { status: result.status };

  registry.inc("optimization_total", labels);

  if (result.status === "failed") {
    registry.inc("optimization_errors_total", {});
  }

  registry.observe("optimization_duration_ms", result.durationMs, labels);

  if (result.tokensSaved > 0) {
    registry.observe("compression_ratio", result.compressionRatio, {});
    // Accumulate total tokens saved (gauge tracks running total)
    registry.set("ai_tokens_saved_total", result.tokensSaved);
  }

  log.info(
    {
      requestId:       result.requestId,
      status:          result.status,
      tokensSaved:     result.tokensSaved,
      compressionRatio: result.compressionRatio,
      qualityScore:    result.qualityScore,
      durationMs:      result.durationMs,
    },
    "Optimization workflow recorded",
  );
}

// ─── HTTP Request Metrics ─────────────────────────────────────────────────────

export function recordHttpRequest(params: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const labels = {
    method: params.method,
    route:  params.route,
    status: String(params.status),
  };

  registry.inc("http_requests_total", labels);

  if (params.status >= 400) {
    registry.inc("http_errors_total", labels);
  }

  registry.observe("http_request_duration_ms", params.durationMs, labels);
}

// ─── Cache Metrics ────────────────────────────────────────────────────────────

export function updateCacheHitRate(hits: number, total: number): void {
  const rate = total > 0 ? hits / total : 0;
  registry.set("cache_hit_rate", rate);
}
