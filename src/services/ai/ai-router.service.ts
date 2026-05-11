/**
 * AI Router Service
 *
 * The single entry point for all AI calls in the application.
 * Responsibilities:
 * - Route requests to the correct provider based on model
 * - Orchestrate fallback via FallbackEngine
 * - Track token usage and costs
 * - Health-check providers and exclude unhealthy ones
 *
 * Why a router instead of calling providers directly:
 * - Callers don't need to know which provider handles which model
 * - Fallback, health checks, and cost tracking happen transparently
 * - Easy to add new routing strategies (cost-based, latency-based) later
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { FallbackEngine } from "@/services/ai/fallback-engine";
import { modelRegistry } from "@/services/ai/model-registry";
import { NotFoundError } from "@/lib/errors";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIModel,
  AIProviderName,
  AIStreamHandler,
  IAIProvider,
} from "@/types/ai";

const log = createChildLogger({ module: "AIRouter" });

// ─── Router ───────────────────────────────────────────────────────────────────

export class AIRouterService {
  private readonly fallbackEngine: FallbackEngine;

  constructor(private readonly providers: Map<AIProviderName, IAIProvider>) {
    this.fallbackEngine = new FallbackEngine(providers);
  }

  /**
   * Route a completion request to the appropriate provider.
   * Automatically handles fallback if the primary model fails.
   */
  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = this.resolveModel(request.model);
    log.info({ model, requestId: request.requestId }, "Routing completion");

    return this.fallbackEngine.completeWithFallback({ ...request, model }, model);
  }

  /**
   * Route a streaming request.
   */
  async stream(
    request: AICompletionRequest,
    onChunk: AIStreamHandler,
  ): Promise<AICompletionResponse> {
    const model = this.resolveModel(request.model);
    log.info({ model, requestId: request.requestId }, "Routing stream");

    return this.fallbackEngine.streamWithFallback({ ...request, model }, model, onChunk);
  }

  /**
   * Get the provider for a specific model (direct access, no fallback).
   */
  getProvider(providerName: AIProviderName): IAIProvider {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new NotFoundError(`AI Provider: ${providerName}`);
    }
    return provider;
  }

  /**
   * Run health checks on all providers.
   * Returns a map of provider name → healthy status.
   */
  async healthCheckAll(): Promise<Record<AIProviderName, boolean>> {
    const results = await Promise.allSettled(
      Array.from(this.providers.entries()).map(async ([name, provider]) => ({
        name,
        healthy: await provider.healthCheck(),
      })),
    );

    return results.reduce(
      (acc, result) => {
        if (result.status === "fulfilled") {
          acc[result.value.name] = result.value.healthy;
        }
        return acc;
      },
      {} as Record<AIProviderName, boolean>,
    );
  }

  /**
   * List all available models across all registered providers.
   */
  getAvailableModels() {
    return Array.from(this.providers.keys()).flatMap((providerName) =>
      modelRegistry.getByProvider(providerName),
    );
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private resolveModel(model?: AIModel): AIModel {
    if (model) return model;

    // Default to GPT-4o if no model specified
    const defaultModel = "gpt-4o" as AIModel;
    log.debug({ defaultModel }, "No model specified, using default");
    return defaultModel;
  }
}
