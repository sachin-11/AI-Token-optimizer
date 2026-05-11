/**
 * Compression Service — Public Facade
 *
 * Single entry point for all compression operations.
 * Wraps the pipeline with convenience methods and sensible defaults.
 *
 * Why a facade over the pipeline:
 * - Callers shouldn't need to know about pipeline internals
 * - Provides pre-configured methods for common use cases
 * - Handles mode selection logic (e.g. auto-mode based on token count)
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getCompressionPipeline } from "@/services/compression/compression-pipeline";
import { getTokenCounter } from "@/services/token/token-counter.service";
import { OptimizationMode, PromptType, type CompressionRequest, type CompressionResult } from "@/types/compression";
import type { AIMessage, AIModel } from "@/types/ai";

const log = createChildLogger({ module: "CompressionService" });

// ─── Auto-mode Thresholds ─────────────────────────────────────────────────────

// Below this token count, compression overhead isn't worth it
const MIN_TOKENS_FOR_COMPRESSION = 100;
// Above this, use AGGRESSIVE automatically
const AGGRESSIVE_THRESHOLD_TOKENS = 3_000;

export class CompressionService {
  private readonly pipeline = getCompressionPipeline();
  private readonly tokenCounter = getTokenCounter();

  /**
   * Compress a text prompt with explicit mode.
   */
  async compress(
    text: string,
    model: AIModel,
    mode: OptimizationMode = OptimizationMode.BALANCED,
    options?: Partial<Pick<CompressionRequest, "promptType" | "targetTokens" | "preservePatterns" | "requestId">>,
  ): Promise<CompressionResult> {
    return this.pipeline.compress({ content: text, model, mode, ...options });
  }

  /**
   * Compress messages array.
   */
  async compressMessages(
    messages: AIMessage[],
    model: AIModel,
    mode: OptimizationMode = OptimizationMode.BALANCED,
    options?: Partial<Pick<CompressionRequest, "promptType" | "targetTokens" | "preservePatterns" | "requestId">>,
  ): Promise<{ messages: AIMessage[]; totalTokensSaved: number }> {
    return this.pipeline.compressMessages(messages, { model, mode, ...options });
  }

  /**
   * Auto-compress: selects mode based on token count.
   * - Short prompts: SAFE (low risk, low reward)
   * - Medium prompts: BALANCED
   * - Long prompts: AGGRESSIVE (high reward justifies risk)
   */
  async autoCompress(
    text: string,
    model: AIModel,
    options?: Partial<Pick<CompressionRequest, "promptType" | "targetTokens" | "preservePatterns" | "requestId">>,
  ): Promise<CompressionResult> {
    const { tokenCount } = await this.tokenCounter.countText(text, model);

    if (tokenCount < MIN_TOKENS_FOR_COMPRESSION) {
      log.debug({ tokenCount }, "Prompt too short for compression — returning as-is");
      // Return a no-op result
      return this.pipeline.compress({
        content: text,
        model,
        mode: OptimizationMode.SAFE,
        ...options,
      });
    }

    const mode =
      tokenCount >= AGGRESSIVE_THRESHOLD_TOKENS
        ? OptimizationMode.AGGRESSIVE
        : OptimizationMode.BALANCED;

    log.debug({ tokenCount, selectedMode: mode }, "Auto-selected compression mode");
    return this.pipeline.compress({ content: text, model, mode, ...options });
  }

  /**
   * Safe compression — minimal risk, suitable for production prompts.
   */
  async safeCompress(text: string, model: AIModel): Promise<CompressionResult> {
    return this.compress(text, model, OptimizationMode.SAFE);
  }

  /**
   * Aggressive compression — maximum token savings.
   * Use when context window is a hard constraint.
   */
  async aggressiveCompress(
    text: string,
    model: AIModel,
    targetTokens?: number,
  ): Promise<CompressionResult> {
    return this.compress(text, model, OptimizationMode.AGGRESSIVE, { targetTokens });
  }

  /**
   * Compress a system prompt specifically.
   * System prompts get BALANCED mode by default — they're critical.
   */
  async compressSystemPrompt(
    systemPrompt: string,
    model: AIModel,
    mode: OptimizationMode = OptimizationMode.BALANCED,
  ): Promise<CompressionResult> {
    return this.compress(systemPrompt, model, mode, {
      promptType: PromptType.SYSTEM,
    });
  }

  /**
   * Compress a coding prompt — protects all code blocks.
   */
  async compressCodingPrompt(
    prompt: string,
    model: AIModel,
  ): Promise<CompressionResult> {
    return this.compress(prompt, model, OptimizationMode.BALANCED, {
      promptType: PromptType.CODING,
    });
  }

  /**
   * Compress an agent prompt — preserves all constraints and rules.
   */
  async compressAgentPrompt(
    prompt: string,
    model: AIModel,
  ): Promise<CompressionResult> {
    return this.compress(prompt, model, OptimizationMode.BALANCED, {
      promptType: PromptType.AGENT,
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: CompressionService | null = null;
export function getCompressionService(): CompressionService {
  instance ??= new CompressionService();
  return instance;
}
