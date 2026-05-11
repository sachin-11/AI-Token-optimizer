/**
 * Context Optimizer
 *
 * Reduces token count of messages before sending to AI provider.
 * Two strategies:
 *
 * 1. Compression  — remove redundancy from individual messages
 * 2. Summarization — replace old conversation turns with a summary
 *
 * When to use each:
 * - Compression:    prompt is verbose but all content is needed
 * - Summarization:  long conversation history, older turns less important
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getTokenCounter } from "@/services/token/token-counter.service";
import { getCompressionService } from "@/services/compression/compression.service";
import { getAIRouter } from "@/services/ai/ai-provider.factory";
import { OptimizationMode } from "@/types/compression";
import type { AIMessage, AIModel } from "@/types/ai";

const log = createChildLogger({ module: "ContextOptimizer" });

// Summarize when conversation exceeds this many tokens
const SUMMARIZATION_THRESHOLD = 4_000;
// Keep this many recent turns verbatim (don't summarize recent context)
const RECENT_TURNS_TO_KEEP = 4;

export class ContextOptimizer {
  private readonly tokenCounter   = getTokenCounter();
  private readonly compressor     = getCompressionService();

  /**
   * Compress individual messages to reduce token count.
   * Preserves all messages but makes each shorter.
   */
  async compressMessages(
    messages: AIMessage[],
    model: AIModel,
    mode: OptimizationMode = OptimizationMode.BALANCED,
  ): Promise<{ messages: AIMessage[]; tokensSaved: number; originalTokens: number }> {
    const originalCount = await this.tokenCounter.countMessages(messages, model);
    const originalTokens = originalCount.tokenCount;

    const result = await this.compressor.compressMessages(messages, model, mode);

    const newCount = await this.tokenCounter.countMessages(result.messages, model);
    const tokensSaved = originalTokens - newCount.tokenCount;

    log.info(
      { originalTokens, newTokens: newCount.tokenCount, tokensSaved, mode },
      "Messages compressed",
    );

    return { messages: result.messages, tokensSaved, originalTokens };
  }

  /**
   * Summarize old conversation turns to reduce context length.
   * Keeps recent turns verbatim, summarizes older ones.
   */
  async summarizeContext(
    messages: AIMessage[],
    model: AIModel,
  ): Promise<{ messages: AIMessage[]; tokensSaved: number; originalTokens: number }> {
    const originalCount = await this.tokenCounter.countMessages(messages, model);
    const originalTokens = originalCount.tokenCount;

    // Only summarize if above threshold
    if (originalTokens < SUMMARIZATION_THRESHOLD) {
      return { messages, tokensSaved: 0, originalTokens };
    }

    const systemMessages = messages.filter((m) => m.role === "system");
    const conversation   = messages.filter((m) => m.role !== "system");

    // Keep recent turns, summarize the rest
    const toSummarize = conversation.slice(0, -RECENT_TURNS_TO_KEEP);
    const toKeep      = conversation.slice(-RECENT_TURNS_TO_KEEP);

    if (toSummarize.length === 0) {
      return { messages, tokensSaved: 0, originalTokens };
    }

    // Generate summary using cheap model
    const summaryText = await this.generateSummary(toSummarize);

    const summaryMessage: AIMessage = {
      role:    "system",
      content: `[Previous conversation summary]: ${summaryText}`,
    };

    const optimizedMessages = [...systemMessages, summaryMessage, ...toKeep];
    const newCount = await this.tokenCounter.countMessages(optimizedMessages, model);
    const tokensSaved = originalTokens - newCount.tokenCount;

    log.info(
      { originalTokens, newTokens: newCount.tokenCount, tokensSaved, summarizedTurns: toSummarize.length },
      "Context summarized",
    );

    return { messages: optimizedMessages, tokensSaved, originalTokens };
  }

  /**
   * Auto-optimize: choose compression vs summarization based on content.
   */
  async autoOptimize(
    messages: AIMessage[],
    model: AIModel,
  ): Promise<{ messages: AIMessage[]; tokensSaved: number; strategy: string }> {
    const count = await this.tokenCounter.countMessages(messages, model);

    // Long conversation → summarize
    if (count.tokenCount > SUMMARIZATION_THRESHOLD && messages.length > RECENT_TURNS_TO_KEEP + 2) {
      const result = await this.summarizeContext(messages, model);
      return { ...result, strategy: "summarization" };
    }

    // Verbose messages → compress
    if (count.tokenCount > 500) {
      const result = await this.compressMessages(messages, model, OptimizationMode.BALANCED);
      return { ...result, strategy: "compression" };
    }

    return { messages, tokensSaved: 0, strategy: "none" };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async generateSummary(messages: AIMessage[]): Promise<string> {
    const router = getAIRouter();
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const response = await router.complete({
      model: "gpt-4o-mini",  // Always use cheap model for summarization
      temperature: 0.3,
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content: "Summarize the following conversation concisely, preserving key facts, decisions, and context. Be brief.",
        },
        { role: "user", content: conversationText },
      ],
    });

    return response.content;
  }
}

let instance: ContextOptimizer | null = null;
export function getContextOptimizer(): ContextOptimizer {
  instance ??= new ContextOptimizer();
  return instance;
}
