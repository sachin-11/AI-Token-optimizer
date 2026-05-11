/**
 * Anthropic (Claude) Provider
 *
 * Implements BaseAIProvider for Anthropic's API.
 * Claude has a different message format — system messages are separate.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { BaseAIProvider } from "@/services/ai/base-provider";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIMessage,
  AIModel,
  AIProviderName,
  AIStreamHandler,
  AnthropicModel,
  TokenUsage,
} from "@/types/ai";

export class AnthropicProvider extends BaseAIProvider {
  readonly name = AIProviderName.ANTHROPIC;
  readonly supportedModels: AIModel[] = Object.values(AnthropicModel);

  private readonly client: Anthropic;

  constructor(config: { apiKey: string; timeoutMs?: number; maxRetries?: number }) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: this.config.timeoutMs,
      maxRetries: 0, // Handled by BaseAIProvider
    });
  }

  // ─── Complete ───────────────────────────────────────────────────────────────

  protected async _complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = (request.model ?? this.getDefaultModel()) as string;
    const { systemPrompt, userMessages } = this.splitMessages(request.messages);

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        ...(systemPrompt && { system: systemPrompt }),
        messages: userMessages,
      });

      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

      return {
        content,
        model,
        provider: this.name,
        usage,
        cost: this.buildCost(model, usage),
        latencyMs: 0,
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
    const { systemPrompt, userMessages } = this.splitMessages(request.messages);
    let fullContent = "";
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        ...(systemPrompt && { system: systemPrompt }),
        messages: userMessages,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          const delta = event.delta.text;
          fullContent += delta;
          await onChunk({ type: "delta", content: delta });
        }

        if (event.type === "message_delta" && event.usage) {
          usage.outputTokens = event.usage.output_tokens;
        }

        if (event.type === "message_start" && event.message.usage) {
          usage.inputTokens = event.message.usage.input_tokens;
        }
      }

      usage.totalTokens = usage.inputTokens + usage.outputTokens;
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
    // Minimal token request to verify API key works
    await this.client.messages.create({
      model: AnthropicModel.CLAUDE_3_HAIKU,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
  }

  protected getDefaultModel(): AIModel {
    return AnthropicModel.CLAUDE_35_SONNET;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Claude separates system prompt from conversation messages.
   * This adapter converts our unified message format to Claude's format.
   */
  private splitMessages(messages: AIMessage[]): {
    systemPrompt: string | undefined;
    userMessages: Anthropic.MessageParam[];
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const systemPrompt =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join("\n\n")
        : undefined;

    const userMessages: Anthropic.MessageParam[] = conversationMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    return { systemPrompt, userMessages };
  }
}

// ─── Factory Function ─────────────────────────────────────────────────────────

export function createAnthropicProvider(overrides?: {
  timeoutMs?: number;
  maxRetries?: number;
}): AnthropicProvider | null {
  const { env } = require("@/config/env") as { env: { ANTHROPIC_API_KEY?: string } };

  // Anthropic is optional — return null if not configured
  if (!env.ANTHROPIC_API_KEY) {
    return null;
  }

  return new AnthropicProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}
