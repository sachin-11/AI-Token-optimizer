/**
 * Token Helper Utilities
 *
 * Pure functions for token-related calculations.
 * No service dependencies — safe to use anywhere including client components.
 *
 * These are the "dumb" helpers. The services above are the "smart" ones.
 */

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format a token count for display (e.g. 1234 → "1.2K", 1234567 → "1.2M")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Format a USD cost for display.
 * Very small amounts use scientific notation to avoid "0.00".
 */
export function formatCostUsd(costUsd: number): string {
  if (costUsd === 0) return "$0.00";
  if (costUsd < 0.000001) return `$${costUsd.toExponential(2)}`;
  if (costUsd < 0.01) return `$${costUsd.toFixed(6)}`;
  if (costUsd < 1) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Format a compression ratio as a percentage reduction.
 * e.g. 0.7 → "30% reduction"
 */
export function formatCompressionRatio(ratio: number): string {
  const reduction = (1 - ratio) * 100;
  return `${reduction.toFixed(1)}% reduction`;
}

/**
 * Format context window utilization.
 * e.g. 0.85 → "85% used"
 */
export function formatContextUtilization(utilizationPercent: number): string {
  return `${utilizationPercent.toFixed(1)}% used`;
}

// ─── Calculations ─────────────────────────────────────────────────────────────

/**
 * Calculate compression ratio between two token counts.
 * Returns a value between 0 (fully compressed) and 1 (no compression).
 */
export function calculateCompressionRatio(
  originalTokens: number,
  compressedTokens: number,
): number {
  if (originalTokens === 0) return 1.0;
  return Number((compressedTokens / originalTokens).toFixed(3));
}

/**
 * Calculate percentage reduction.
 */
export function calculatePercentReduction(
  originalTokens: number,
  compressedTokens: number,
): number {
  if (originalTokens === 0) return 0;
  return Number((((originalTokens - compressedTokens) / originalTokens) * 100).toFixed(1));
}

/**
 * Quick character-based token estimate.
 * Use when you need a fast estimate without async tiktoken.
 * Accuracy: ±15% for English prose.
 */
export function quickEstimateTokens(text: string): number {
  // ~4 chars per token for English, ~3 for code
  const isCode = /[{}()[\];=><]{3,}/.test(text);
  const charsPerToken = isCode ? 3 : 4;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate tokens from word count.
 * Rule of thumb: 1 word ≈ 1.3 tokens for English.
 */
export function estimateTokensFromWords(wordCount: number): number {
  return Math.ceil(wordCount * 1.3);
}

/**
 * Estimate word count from token count.
 */
export function estimateWordsFromTokens(tokenCount: number): number {
  return Math.floor(tokenCount / 1.3);
}

// ─── Context Window Helpers ───────────────────────────────────────────────────

/**
 * Calculate how many tokens are available for a response
 * given the input token count and context window size.
 */
export function availableResponseTokens(
  contextWindow: number,
  inputTokens: number,
  reserveTokens = 100,
): number {
  return Math.max(0, contextWindow - inputTokens - reserveTokens);
}

/**
 * Get a human-readable context window utilization label.
 */
export function getUtilizationLabel(
  utilizationPercent: number,
): "low" | "moderate" | "high" | "critical" {
  if (utilizationPercent < 50) return "low";
  if (utilizationPercent < 75) return "moderate";
  if (utilizationPercent < 90) return "high";
  return "critical";
}

/**
 * Get a color class for utilization (for UI badges).
 */
export function getUtilizationColor(utilizationPercent: number): string {
  const label = getUtilizationLabel(utilizationPercent);
  const colors = {
    low: "text-green-600 bg-green-50",
    moderate: "text-yellow-600 bg-yellow-50",
    high: "text-orange-600 bg-orange-50",
    critical: "text-red-600 bg-red-50",
  };
  return colors[label];
}
