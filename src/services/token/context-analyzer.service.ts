/**
 * Context Analyzer Service
 *
 * Analyzes whether a prompt fits within a model's context window
 * and recommends the appropriate action when it doesn't.
 *
 * Decision tree for overflow:
 * 1. < 10% over limit  → compress (remove redundancy)
 * 2. 10-40% over limit → summarize (condense context)
 * 3. 40-70% over limit → truncate (drop oldest messages)
 * 4. > 70% over limit  → use_larger_model (switch to 128k/200k context model)
 */

import "server-only";

import { modelRegistry } from "@/services/ai/model-registry";
import { getTokenCounter } from "@/services/token/token-counter.service";
import type { AIMessage, AIModel } from "@/types/ai";
import type {
  ContextRecommendation,
  ContextWindowAnalysis,
} from "@/types/tokenizer";

// ─── Thresholds ───────────────────────────────────────────────────────────────

const OVERFLOW_THRESHOLDS = {
  compress: 0.10,       // Up to 10% over → compress
  summarize: 0.40,      // 10-40% over → summarize
  truncate: 0.70,       // 40-70% over → truncate
  // > 70% over → use_larger_model
} as const;

// Reserve tokens for the model's response (don't fill context 100%)
const RESPONSE_TOKEN_RESERVE = 1_000;

// ─── Context Analyzer ────────────────────────────────────────────────────────

export class ContextAnalyzerService {
  private readonly tokenCounter = getTokenCounter();

  /**
   * Analyze whether messages fit in a model's context window.
   */
  async analyzeMessages(
    messages: AIMessage[],
    model: AIModel,
  ): Promise<ContextWindowAnalysis> {
    const info = modelRegistry.get(model);
    const countResult = await this.tokenCounter.countMessages(messages, model);

    // Effective limit accounts for response reserve
    const effectiveLimit = info.contextWindow - RESPONSE_TOKEN_RESERVE;
    const usedTokens = countResult.tokenCount;
    const availableTokens = Math.max(0, effectiveLimit - usedTokens);
    const overflowTokens = Math.max(0, usedTokens - effectiveLimit);
    const utilizationPercent = Number(
      ((usedTokens / info.contextWindow) * 100).toFixed(1),
    );

    return {
      model,
      contextWindow: info.contextWindow,
      usedTokens,
      availableTokens,
      utilizationPercent,
      fitsInContext: usedTokens <= effectiveLimit,
      overflowTokens,
      recommendation: this.getRecommendation(overflowTokens, effectiveLimit),
    };
  }

  /**
   * Analyze a plain text string against a model's context window.
   */
  async analyzeText(
    text: string,
    model: AIModel,
  ): Promise<ContextWindowAnalysis> {
    const info = modelRegistry.get(model);
    const countResult = await this.tokenCounter.countText(text, model);
    const effectiveLimit = info.contextWindow - RESPONSE_TOKEN_RESERVE;
    const usedTokens = countResult.tokenCount;
    const availableTokens = Math.max(0, effectiveLimit - usedTokens);
    const overflowTokens = Math.max(0, usedTokens - effectiveLimit);

    return {
      model,
      contextWindow: info.contextWindow,
      usedTokens,
      availableTokens,
      utilizationPercent: Number(((usedTokens / info.contextWindow) * 100).toFixed(1)),
      fitsInContext: usedTokens <= effectiveLimit,
      overflowTokens,
      recommendation: this.getRecommendation(overflowTokens, effectiveLimit),
    };
  }

  /**
   * Find the smallest (cheapest) model that fits the given token count.
   * Used by the AI router to auto-select the most cost-effective model.
   */
  findSmallestFittingModel(
    tokenCount: number,
    candidateModels: AIModel[],
  ): AIModel | null {
    const fitting = candidateModels
      .map((model) => {
        const info = modelRegistry.find(model);
        if (!info) return null;
        return { model, contextWindow: info.contextWindow, cost: info.inputCostPerMToken };
      })
      .filter(
        (m): m is NonNullable<typeof m> =>
          m !== null && m.contextWindow >= tokenCount + RESPONSE_TOKEN_RESERVE,
      )
      // Sort by cost ascending — cheapest model that fits
      .sort((a, b) => a.cost - b.cost);

    return fitting[0]?.model ?? null;
  }

  /**
   * Truncate messages to fit within a token limit.
   * Removes oldest non-system messages first (FIFO truncation).
   * Always preserves the system message and the latest user message.
   */
  async truncateToFit(
    messages: AIMessage[],
    model: AIModel,
    targetTokens?: number,
  ): Promise<{ messages: AIMessage[]; removedCount: number; finalTokenCount: number }> {
    const info = modelRegistry.get(model);
    const limit = targetTokens ?? info.contextWindow - RESPONSE_TOKEN_RESERVE;

    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Always keep the last user message
    const lastMessage = conversationMessages.at(-1);
    const middleMessages = conversationMessages.slice(0, -1);

    let result = [...systemMessages, ...middleMessages, ...(lastMessage ? [lastMessage] : [])];
    let removedCount = 0;

    // Remove from the front of middle messages until we fit
    while (middleMessages.length > 0) {
      const countResult = await this.tokenCounter.countMessages(result, model);
      if (countResult.tokenCount <= limit) break;

      middleMessages.shift();
      removedCount++;
      result = [...systemMessages, ...middleMessages, ...(lastMessage ? [lastMessage] : [])];
    }

    const finalCount = await this.tokenCounter.countMessages(result, model);

    return {
      messages: result,
      removedCount,
      finalTokenCount: finalCount.tokenCount,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private getRecommendation(
    overflowTokens: number,
    effectiveLimit: number,
  ): ContextRecommendation {
    if (overflowTokens === 0) return "ok";

    const overflowRatio = overflowTokens / effectiveLimit;

    if (overflowRatio <= OVERFLOW_THRESHOLDS.compress) return "compress";
    if (overflowRatio <= OVERFLOW_THRESHOLDS.summarize) return "summarize";
    if (overflowRatio <= OVERFLOW_THRESHOLDS.truncate) return "truncate";
    return "use_larger_model";
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: ContextAnalyzerService | null = null;

export function getContextAnalyzer(): ContextAnalyzerService {
  instance ??= new ContextAnalyzerService();
  return instance;
}
