/**
 * Compression Analyzer Service
 *
 * Analyzes token savings from prompt compression/optimization.
 *
 * Use cases:
 * - Show users how much they saved after optimization
 * - Track compression effectiveness over time
 * - Calculate ROI of the optimization platform
 * - Power the analytics dashboard
 */

import "server-only";

import { modelRegistry } from "@/services/ai/model-registry";
import { getTokenCounter } from "@/services/token/token-counter.service";
import type { AIModel } from "@/types/ai";
import type { CompressionAnalysis } from "@/types/tokenizer";

export class CompressionAnalyzerService {
  private readonly tokenCounter = getTokenCounter();

  /**
   * Analyze compression between original and optimized text.
   */
  async analyzeCompression(
    originalText: string,
    compressedText: string,
    model: AIModel,
  ): Promise<CompressionAnalysis> {
    const [originalCount, compressedCount] = await Promise.all([
      this.tokenCounter.countText(originalText, model),
      this.tokenCounter.countText(compressedText, model),
    ]);

    const tokensSaved = originalCount.tokenCount - compressedCount.tokenCount;
    const compressionRatio =
      originalCount.tokenCount > 0
        ? compressedCount.tokenCount / originalCount.tokenCount
        : 1.0;
    const percentReduction =
      originalCount.tokenCount > 0
        ? (tokensSaved / originalCount.tokenCount) * 100
        : 0;

    // Calculate cost savings (assuming same output length)
    const originalCost = modelRegistry.calculateCost(model, originalCount.tokenCount, 0);
    const compressedCost = modelRegistry.calculateCost(model, compressedCount.tokenCount, 0);
    const costSavingsUsd = originalCost.inputCostUsd - compressedCost.inputCostUsd;

    return {
      originalTokens: originalCount.tokenCount,
      compressedTokens: compressedCount.tokenCount,
      compressionRatio: Number(compressionRatio.toFixed(3)),
      tokensSaved,
      percentReduction: Number(percentReduction.toFixed(1)),
      costSavingsUsd: Number(costSavingsUsd.toFixed(8)),
      model,
    };
  }

  /**
   * Calculate aggregate compression stats across multiple optimizations.
   * Used for the analytics dashboard.
   */
  aggregateCompressionStats(
    analyses: CompressionAnalysis[],
  ): {
    totalOriginalTokens: number;
    totalCompressedTokens: number;
    totalTokensSaved: number;
    averageCompressionRatio: number;
    averagePercentReduction: number;
    totalCostSavingsUsd: number;
    optimizationCount: number;
  } {
    if (analyses.length === 0) {
      return {
        totalOriginalTokens: 0,
        totalCompressedTokens: 0,
        totalTokensSaved: 0,
        averageCompressionRatio: 1.0,
        averagePercentReduction: 0,
        totalCostSavingsUsd: 0,
        optimizationCount: 0,
      };
    }

    const totalOriginalTokens = analyses.reduce((sum, a) => sum + a.originalTokens, 0);
    const totalCompressedTokens = analyses.reduce((sum, a) => sum + a.compressedTokens, 0);
    const totalTokensSaved = totalOriginalTokens - totalCompressedTokens;
    const averageCompressionRatio =
      analyses.reduce((sum, a) => sum + a.compressionRatio, 0) / analyses.length;
    const averagePercentReduction =
      analyses.reduce((sum, a) => sum + a.percentReduction, 0) / analyses.length;
    const totalCostSavingsUsd = analyses.reduce((sum, a) => sum + a.costSavingsUsd, 0);

    return {
      totalOriginalTokens,
      totalCompressedTokens,
      totalTokensSaved,
      averageCompressionRatio: Number(averageCompressionRatio.toFixed(3)),
      averagePercentReduction: Number(averagePercentReduction.toFixed(1)),
      totalCostSavingsUsd: Number(totalCostSavingsUsd.toFixed(6)),
      optimizationCount: analyses.length,
    };
  }

  /**
   * Project annual savings based on current compression performance.
   */
  projectAnnualSavings(
    dailyRequests: number,
    avgCompressionRatio: number,
    avgInputTokens: number,
    model: AIModel,
  ): {
    dailySavingsUsd: number;
    monthlySavingsUsd: number;
    annualSavingsUsd: number;
    tokensSavedPerYear: number;
  } {
    const tokensSavedPerRequest = avgInputTokens * (1 - avgCompressionRatio);
    const tokensSavedPerYear = tokensSavedPerRequest * dailyRequests * 365;

    const costPerToken = modelRegistry.get(model).inputCostPerMToken / 1_000_000;
    const dailySavingsUsd = tokensSavedPerRequest * dailyRequests * costPerToken;

    return {
      dailySavingsUsd: Number(dailySavingsUsd.toFixed(4)),
      monthlySavingsUsd: Number((dailySavingsUsd * 30).toFixed(4)),
      annualSavingsUsd: Number((dailySavingsUsd * 365).toFixed(4)),
      tokensSavedPerYear: Math.round(tokensSavedPerYear),
    };
  }

  /**
   * Determine if compression is worth it based on cost/benefit.
   * Compression has overhead (latency, complexity) — only worth it if savings are meaningful.
   */
  isCompressionWorthwhile(analysis: CompressionAnalysis): {
    worthwhile: boolean;
    reason: string;
  } {
    // Not worth it if we saved < 5% tokens
    if (analysis.percentReduction < 5) {
      return {
        worthwhile: false,
        reason: "Minimal token reduction (<5%) — overhead not justified",
      };
    }

    // Not worth it if cost savings < $0.0001 (negligible)
    if (analysis.costSavingsUsd < 0.0001) {
      return {
        worthwhile: false,
        reason: "Cost savings negligible (<$0.0001)",
      };
    }

    // Worth it if we saved >= 20% tokens
    if (analysis.percentReduction >= 20) {
      return {
        worthwhile: true,
        reason: `Significant reduction (${analysis.percentReduction.toFixed(1)}%)`,
      };
    }

    // Moderate savings — worth it
    return {
      worthwhile: true,
      reason: `Moderate savings (${analysis.percentReduction.toFixed(1)}% reduction, $${analysis.costSavingsUsd.toFixed(6)} saved)`,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: CompressionAnalyzerService | null = null;

export function getCompressionAnalyzer(): CompressionAnalyzerService {
  instance ??= new CompressionAnalyzerService();
  return instance;
}
