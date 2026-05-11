/**
 * Tokenizer Type Definitions
 *
 * Separate from ai.ts because tokenization is a cross-cutting concern —
 * it's used by optimization, caching, analytics, and cost tracking.
 * Keeping types co-located with their domain prevents circular imports.
 */

import type { AIMessage, AIModel, CostBreakdown } from "@/types/ai";

// ─── Encoding Names ───────────────────────────────────────────────────────────

/**
 * tiktoken encoding names.
 * Each encoding handles a family of models.
 *
 * cl100k_base  → GPT-4, GPT-3.5-turbo, text-embedding-ada-002
 * o200k_base   → GPT-4o, GPT-4o-mini (newer models)
 * p50k_base    → Codex, text-davinci-002/003
 */
export type TiktokenEncoding = "cl100k_base" | "o200k_base" | "p50k_base" | "r50k_base";

// ─── Token Count Results ──────────────────────────────────────────────────────

export interface TokenCountResult {
  tokenCount: number;
  model: AIModel;
  encoding: TiktokenEncoding | "estimated";
  isEstimate: boolean;
}

export interface MessageTokenCountResult extends TokenCountResult {
  // Per-message breakdown for debugging
  messageBreakdown: MessageTokenBreakdown[];
  // Overhead added by chat format (role tokens, separators)
  chatFormatOverhead: number;
}

export interface MessageTokenBreakdown {
  role: AIMessage["role"];
  contentTokens: number;
  overheadTokens: number;
  totalTokens: number;
}

// ─── Cost Estimation ──────────────────────────────────────────────────────────

export interface TokenCostEstimate {
  model: AIModel;
  inputTokens: number;
  estimatedOutputTokens: number;
  cost: CostBreakdown;
  // Confidence level of the estimate
  confidence: "exact" | "estimated";
}

// ─── Context Window Analysis ──────────────────────────────────────────────────

export interface ContextWindowAnalysis {
  model: AIModel;
  contextWindow: number;
  usedTokens: number;
  availableTokens: number;
  utilizationPercent: number;
  fitsInContext: boolean;
  // How many tokens need to be removed to fit
  overflowTokens: number;
  // Recommended action if overflow
  recommendation: ContextRecommendation;
}

export type ContextRecommendation =
  | "ok"
  | "compress"
  | "summarize"
  | "truncate"
  | "use_larger_model";

// ─── Compression Analytics ────────────────────────────────────────────────────

export interface CompressionAnalysis {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;       // 0-1, lower = more compressed
  tokensSaved: number;
  percentReduction: number;       // 0-100
  costSavingsUsd: number;
  model: AIModel;
}

// ─── Batch Analysis ───────────────────────────────────────────────────────────

export interface BatchTokenAnalysis {
  items: TokenCountResult[];
  totalTokens: number;
  averageTokens: number;
  minTokens: number;
  maxTokens: number;
  totalEstimatedCost: CostBreakdown;
}
