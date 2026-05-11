/**
 * Cost Optimization Type Definitions
 */

import type { AIModel, AIMessage, AICompletionResponse } from "@/types/ai";

// ─── Routing Decision ─────────────────────────────────────────────────────────

export type RoutingStrategy =
  | "cheapest"          // Always use cheapest model that meets quality bar
  | "balanced"          // Balance cost vs quality
  | "quality"           // Prioritize quality, cost secondary
  | "fastest";          // Minimize latency

export interface RoutingDecision {
  selectedModel:    AIModel;
  originalModel:    AIModel;
  strategy:         RoutingStrategy;
  estimatedCostUsd: number;
  savingsVsOriginal: number;
  savingsPercent:   number;
  reason:           string;
  alternatives:     ModelAlternative[];
}

export interface ModelAlternative {
  model:            AIModel;
  estimatedCostUsd: number;
  qualityScore:     number;   // 0-100 relative quality
  latencyMs:        number;   // estimated p50 latency
}

// ─── Token Budget ─────────────────────────────────────────────────────────────

export interface TokenBudget {
  userId:           string;
  dailyLimitTokens: number;
  monthlyLimitUsd:  number;
  usedTodayTokens:  number;
  usedMonthUsd:     number;
  remainingTokens:  number;
  remainingUsd:     number;
  utilizationPct:   number;
  isExhausted:      boolean;
  willExceedWith:   (tokens: number) => boolean;
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

export interface DuplicateCheckResult {
  isDuplicate:      boolean;
  similarity:       number;
  cachedResponse?:  AICompletionResponse;
  savedCostUsd?:    number;
  dedupeKey:        string;
}

// ─── Optimization Result ──────────────────────────────────────────────────────

export interface CostOptimizedRequest {
  messages:         AIMessage[];
  model:            AIModel;
  originalModel:    AIModel;
  originalMessages: AIMessage[];
  optimizations:    AppliedOptimization[];
  estimatedCostUsd: number;
  estimatedSavings: number;
}

export interface AppliedOptimization {
  type:        OptimizationType;
  description: string;
  savedTokens: number;
  savedUsd:    number;
}

export type OptimizationType =
  | "model_downgrade"
  | "context_compression"
  | "cache_hit"
  | "deduplication"
  | "summarization"
  | "token_budget_enforcement";

// ─── Cost Analytics ───────────────────────────────────────────────────────────

export interface CostBreakdownReport {
  period:           "day" | "week" | "month";
  totalSpendUsd:    number;
  savedByCache:     number;
  savedByRouting:   number;
  savedByCompression: number;
  totalSavingsUsd:  number;
  savingsPercent:   number;
  byModel:          ModelSpend[];
  byDay:            DailySpend[];
  projectedMonthly: number;
}

export interface ModelSpend {
  model:        AIModel;
  requests:     number;
  inputTokens:  number;
  outputTokens: number;
  spendUsd:     number;
  pctOfTotal:   number;
}

export interface DailySpend {
  date:     string;
  spendUsd: number;
  requests: number;
  tokens:   number;
}
