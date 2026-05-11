/**
 * OpenAI Provider
 *
 * Implements BaseAIProvider for OpenAI's API.
 * Uses the official openai SDK — handles both completion and streaming.
 */

import "server-only";

import OpenAI from "openai";

import { BaseAIProvider } from "@/services/ai/base-provider";
import { modelRegistry } from "@/services/ai/model-registry";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIModel,
  AIProviderName,
  AIStreamHandler,
  OpenAIModel,
  TokenUsage,
} from "@/types/ai";

export class OpenAIProvider extends BaseAIProvider {
  readonly name = AIProviderName.OPENAI;
  readonly supportedModels: AIModel[] = Object.values(OpenAIModel);

  private readonly client: OpenAI;

  constructor(config: { apiKey: string; organizationId?: string; timeoutMs?: number; maxRetries?: number }) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organizationId,
      timeout: this.config.timeoutMs,
      // We handle retries ourselves in BaseAIProvider for consistency
      maxRetries: 0,
    });
  }

  // ─── Complete ───────────────────────────────────────────────────────────────

  protected async _complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = (request.model ?? this.getDefaultModel()) as string;

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stream: false,
      });

      const choice = response.choices[0];
      if (!choice?.message.content) {
        throw new Error("OpenAI returned empty response");
      }

      const usage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      return {
        content: choice.message.content,
        model,
        provider: this.name,
        usage,
        cost: this.buildCost(model, usage),
        latencyMs: 0, // Set by base class
        requestId: request.requestId,
      };
    } catch (error) {
      this.handleProviderError(error, model);
    }
  }

  // ─── Stream ─────────────────────────────────────────────────────────────────

  protected async _stream(
    request: AICompletionRequest,
    onChunk: AIStreamHandler,
  ): Promise<AICompletionResponse> {
    const model = (request.model ?? this.getDefaultModel()) as string;
    let fullContent = "";
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";

        if (delta) {
          fullContent += delta;
          await onChunk({ type: "delta", content: delta });
        }

        // Final chunk contains usage stats
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      this.emitDoneChunk(onChunk, usage, model);

      return {
        content: fullContent,
        model,
        provider: this.name,
        usage,
        cost: this.buildCost(model, usage),
        latencyMs: 0,
        requestId: request.requestId,
      };
    } catch (error) {
      await onChunk({ type: "error", error: String(error) });
      this.handleProviderError(error, model);
    }
  }

  // ─── Health Check ────────────────────────────────────────────────────────────

  protected async _healthCheck(): Promise<void> {
    // Lightweight check — list models endpoint
    await this.client.models.list();
  }

  protected getDefaultModel(): AIModel {
    return OpenAIModel.GPT_4O;
  }
}

// ─── Factory Function ─────────────────────────────────────────────────────────

export function createOpenAIProvider(overrides?: {
  timeoutMs?: number;
  maxRetries?: number;
}): OpenAIProvider {
  const { env } = require("@/config/env") as { env: { OPENAI_API_KEY: string; OPENAI_ORG_ID?: string } };
  return new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    organizationId: env.OPENAI_ORG_ID,
    ...overrides,
  });
}
