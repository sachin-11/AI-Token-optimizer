/**
 * Base AI Provider — Abstract class with shared retry/timeout/cost logic
 *
 * Why abstract base class here (not pure interface):
 * - Retry logic, timeout wrapping, cost calculation are identical across providers
 * - DRY: each provider only implements the actual API call, not the plumbing
 * - Template Method pattern: base defines the algorithm, subclasses fill in steps
 */

import "server-only";

import { nanoid } from "nanoid";

import { createChildLogger } from "@/lib/logger";
import { AIProviderError, AIQuotaExceededError, TokenLimitError } from "@/lib/errors";
import { withRetry, withTimeout } from "@/utils/async";
import { modelRegistry } from "@/services/ai/model-registry";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIProviderConfig,
  AIProviderName,
  AIStreamChunk,
  AIStreamHandler,
  AIModel,
  FallbackTrigger,
  TokenUsage,
} from "@/types/ai";

// ─── Abstract Base ────────────────────────────────────────────────────────────

export abstract class BaseAIProvider {
  abstract readonly name: AIProviderName;
  abstract readonly supportedModels: AIModel[];

  protected readonly config: Required<AIProviderConfig>;
  protected readonly log;

  constructor(config: AIProviderConfig) {
    this.config = {
      apiKey: config.apiKey,
      organizationId: config.organizationId ?? "",
      baseUrl: config.baseUrl ?? "",
      timeoutMs: config.timeoutMs ?? 30_000,
      maxRetries: config.maxRetries ?? 3,
    };
    this.log = createChildLogger({ provider: this.constructor.name });
  }

  // ─── Public API (Template Methods) ─────────────────────────────────────────

  /**
   * Complete with retry + timeout + cost tracking.
   * Subclasses implement _complete() — this method handles the rest.
   */
  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const requestId = request.requestId ?? nanoid();
    const model = request.model ?? this.getDefaultModel();
    const startTime = Date.now();

    this.log.info({ requestId, model }, "Starting completion");

    const response = await withRetry(
      () =>
        withTimeout(
          this._complete({ ...request, model, requestId }),
          this.config.timeoutMs,
          `AI completion timed out after ${this.config.timeoutMs}ms`,
        ),
      {
        maxAttempts: this.config.maxRetries,
        onRetry: (error, attempt) => {
          this.log.warn({ requestId, attempt, err: error }, "Retrying completion");
        },
      },
    );

    const latencyMs = Date.now() - startTime;
    this.log.info(
      { requestId, model, latencyMs, tokens: response.usage.totalTokens },
      "Completion successful",
    );

    return { ...response, latencyMs, requestId };
  }

  /**
   * Stream with retry + timeout.
   * Subclasses implement _stream().
   */
  async stream(
    request: AICompletionRequest,
    onChunk: AIStreamHandler,
  ): Promise<AICompletionResponse> {
    const requestId = request.requestId ?? nanoid();
    const model = request.model ?? this.getDefaultModel();
    const startTime = Date.now();

    this.log.info({ requestId, model }, "Starting stream");

    const response = await withRetry(
      () =>
        withTimeout(
          this._stream({ ...request, model, requestId }, onChunk),
          // Streaming gets a longer timeout
          this.config.timeoutMs * 4,
          `AI stream timed out`,
        ),
      { maxAttempts: 2 }, // Fewer retries for streams
    );

    const latencyMs = Date.now() - startTime;
    this.log.info({ requestId, model, latencyMs }, "Stream completed");

    return { ...response, latencyMs, requestId };
  }

  supportsModel(model: AIModel): boolean {
    return this.supportedModels.includes(model);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await withTimeout(this._healthCheck(), 5_000, "Health check timed out");
      return true;
    } catch {
      this.log.warn("Health check failed");
      return false;
    }
  }

  // ─── Protected Helpers ──────────────────────────────────────────────────────

  /**
   * Build cost breakdown from token usage.
   */
  protected buildCost(model: AIModel, usage: TokenUsage) {
    return modelRegistry.calculateCost(model, usage.inputTokens, usage.outputTokens);
  }

  /**
   * Map provider-specific errors to our AppError hierarchy.
   * Each provider overrides this to handle their specific error shapes.
   */
  protected handleProviderError(error: unknown, model: AIModel): never {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      if (msg.includes("rate limit") || msg.includes("429")) {
        throw Object.assign(
          new AIProviderError(`Rate limit hit on ${this.name}`, this.name, model, error),
          { fallbackTrigger: FallbackTrigger.RATE_LIMIT },
        );
      }

      if (msg.includes("quota") || msg.includes("billing")) {
        throw new AIQuotaExceededError(this.name);
      }

      if (msg.includes("context") || msg.includes("token") || msg.includes("length")) {
        const info = modelRegistry.find(model);
        throw new TokenLimitError(0, info?.contextWindow ?? 0);
      }

      if (msg.includes("timeout") || msg.includes("timed out")) {
        throw Object.assign(
          new AIProviderError(`Timeout on ${this.name}`, this.name, model, error),
          { fallbackTrigger: FallbackTrigger.TIMEOUT },
        );
      }
    }

    throw new AIProviderError(
      `${this.name} provider error: ${error instanceof Error ? error.message : "Unknown error"}`,
      this.name,
      model,
      error instanceof Error ? error : undefined,
    );
  }

  // ─── Abstract Methods — subclasses must implement ───────────────────────────

  protected abstract _complete(request: AICompletionRequest): Promise<AICompletionResponse>;

  protected abstract _stream(
    request: AICompletionRequest,
    onChunk: AIStreamHandler,
  ): Promise<AICompletionResponse>;

  protected abstract _healthCheck(): Promise<void>;

  protected abstract getDefaultModel(): AIModel;

  // ─── Utility ────────────────────────────────────────────────────────────────

  /**
   * Emit a done chunk with final usage stats — used by stream implementations.
   */
  protected emitDoneChunk(onChunk: AIStreamHandler, usage: TokenUsage, model: AIModel) {
    const cost = this.buildCost(model, usage);
    void onChunk({ type: "done", usage, cost });
  }
}
