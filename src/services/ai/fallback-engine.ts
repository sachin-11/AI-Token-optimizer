/**
 * Fallback Engine
 *
 * Implements the model fallback strategy.
 *
 * Why a dedicated fallback engine:
 * - Fallback logic is complex — it needs to know which errors are retryable,
 *   which models are equivalent, and how to preserve request intent
 * - Separating it from the router keeps each class focused (SRP)
 * - Makes fallback behavior testable in isolation
 *
 * Strategy:
 * 1. Try primary model
 * 2. On fallback-triggering error, try next model in chain
 * 3. If all models fail, throw the last error
 * 4. Log every fallback for cost/reliability analytics
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { AIProviderError } from "@/lib/errors";
import { modelRegistry } from "@/services/ai/model-registry";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIModel,
  AIProviderName,
  AIStreamHandler,
  FallbackTrigger,
} from "@/types/ai";
import { IAIProvider } from "@/types/ai";

const log = createChildLogger({ module: "FallbackEngine" });

// ─── Fallback Chain Definition ────────────────────────────────────────────────

/**
 * Default fallback chains per provider.
 * When a model fails, we try the next one in the chain.
 *
 * Design principle: fallback to cheaper/faster models, not more expensive ones.
 * This keeps costs predictable under failure conditions.
 */
export const DEFAULT_FALLBACK_CHAINS: Record<string, AIModel[]> = {
  "gpt-4o": ["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-1.5-flash"],
  "gpt-4o-mini": ["gpt-3.5-turbo", "claude-3-haiku-20240307"],
  "gpt-4-turbo": ["gpt-4o", "gpt-4o-mini"],
  "claude-3-5-sonnet-20241022": ["claude-3-haiku-20240307", "gpt-4o-mini"],
  "claude-3-opus-20240229": ["claude-3-5-sonnet-20241022", "gpt-4o"],
  "gemini-1.5-pro": ["gemini-1.5-flash", "gpt-4o-mini"],
};

// Errors that should trigger fallback vs errors that should propagate immediately
const FALLBACK_TRIGGERING_ERRORS = new Set([
  FallbackTrigger.RATE_LIMIT,
  FallbackTrigger.TIMEOUT,
  FallbackTrigger.PROVIDER_ERROR,
  FallbackTrigger.QUOTA_EXCEEDED,
]);

// ─── Fallback Engine ──────────────────────────────────────────────────────────

export class FallbackEngine {
  constructor(
    private readonly providers: Map<AIProviderName, IAIProvider>,
    private readonly fallbackChains: Record<string, AIModel[]> = DEFAULT_FALLBACK_CHAINS,
  ) {}

  /**
   * Execute a completion with automatic fallback.
   */
  async completeWithFallback(
    request: AICompletionRequest,
    primaryModel: AIModel,
  ): Promise<AICompletionResponse & { usedFallback: boolean; attemptedModels: AIModel[] }> {
    const chain = this.buildChain(primaryModel);
    const attemptedModels: AIModel[] = [];
    let lastError: Error | undefined;

    for (const model of chain) {
      const provider = this.getProviderForModel(model);
      if (!provider) {
        log.warn({ model }, "No provider available for model, skipping");
        continue;
      }

      attemptedModels.push(model);

      try {
        log.info(
          { model, attempt: attemptedModels.length, primaryModel },
          "Attempting completion",
        );

        const response = await provider.complete({ ...request, model });

        if (model !== primaryModel) {
          log.warn(
            { primaryModel, usedModel: model, attempts: attemptedModels.length },
            "Used fallback model",
          );
        }

        return {
          ...response,
          usedFallback: model !== primaryModel,
          attemptedModels,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const shouldFallback = this.shouldTriggerFallback(error);
        log.warn(
          { model, shouldFallback, err: lastError.message },
          "Model attempt failed",
        );

        if (!shouldFallback) {
          // Non-retryable error (e.g. validation) — don't try other models
          throw lastError;
        }
      }
    }

    throw new AIProviderError(
      `All models in fallback chain failed. Attempted: ${attemptedModels.join(", ")}`,
      AIProviderName.OPENAI,
      primaryModel,
      lastError,
    );
  }

  /**
   * Execute a stream with fallback (falls back to non-streaming if needed).
   */
  async streamWithFallback(
    request: AICompletionRequest,
    primaryModel: AIModel,
    onChunk: AIStreamHandler,
  ): Promise<AICompletionResponse> {
    const chain = this.buildChain(primaryModel);

    for (const model of chain) {
      const provider = this.getProviderForModel(model);
      if (!provider) continue;

      try {
        return await provider.stream({ ...request, model }, onChunk);
      } catch (error) {
        if (!this.shouldTriggerFallback(error)) throw error;
        log.warn({ model }, "Stream fallback triggered");
      }
    }

    throw new Error("All streaming fallbacks exhausted");
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private buildChain(primaryModel: AIModel): AIModel[] {
    const fallbacks = this.fallbackChains[primaryModel] ?? [];
    return [primaryModel, ...fallbacks];
  }

  private getProviderForModel(model: AIModel): IAIProvider | undefined {
    const info = modelRegistry.find(model);
    if (!info) return undefined;
    return this.providers.get(info.provider);
  }

  private shouldTriggerFallback(error: unknown): boolean {
    if (error instanceof AIProviderError) {
      const trigger = (error as AIProviderError & { fallbackTrigger?: FallbackTrigger })
        .fallbackTrigger;
      if (trigger) return FALLBACK_TRIGGERING_ERRORS.has(trigger);
    }
    // Default: fallback on unknown errors
    return true;
  }
}
