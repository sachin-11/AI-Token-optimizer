/**
 * Whitespace Normalization Strategy — SAFE mode
 *
 * Removes redundant whitespace without touching content.
 * Zero risk of meaning loss — always applied first.
 *
 * Transformations:
 * - Multiple blank lines → single blank line
 * - Trailing whitespace on lines
 * - Multiple spaces → single space
 * - Leading/trailing whitespace
 */

import "server-only";

import { OptimizationMode, PromptType } from "@/types/compression";
import type { ICompressionStrategy, StrategyContext, StrategyResult } from "@/types/compression";

export class WhitespaceStrategy implements ICompressionStrategy {
  readonly name = "whitespace-normalization";
  readonly description = "Remove redundant whitespace and blank lines";
  readonly minimumMode = OptimizationMode.SAFE;
  readonly applicableTypes: PromptType[] = []; // All types

  async apply(text: string, _context: StrategyContext): Promise<StrategyResult> {
    const transformations: string[] = [];
    let result = text;

    // Multiple consecutive blank lines → single blank line
    const beforeBlankLines = result.length;
    result = result.replace(/\n{3,}/g, "\n\n");
    if (result.length < beforeBlankLines) transformations.push("collapsed-blank-lines");

    // Trailing whitespace on each line
    const beforeTrailing = result.length;
    result = result.replace(/[ \t]+$/gm, "");
    if (result.length < beforeTrailing) transformations.push("removed-trailing-whitespace");

    // Multiple spaces → single space (not at line start — preserves indentation)
    const beforeMultiSpace = result.length;
    result = result.replace(/([^\n]) {2,}/g, "$1 ");
    if (result.length < beforeMultiSpace) transformations.push("collapsed-multiple-spaces");

    // Trim overall
    const trimmed = result.trim();
    if (trimmed.length < result.length) transformations.push("trimmed-edges");
    result = trimmed;

    return {
      text: result,
      transformationsApplied: transformations,
      tokensRemoved: 0, // Calculated by pipeline
    };
  }
}
