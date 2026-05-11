/**
 * Google Gemini Provider
 *
 * Implements BaseAIProvider for Google's Gemini API.
 * Uses @google/generative-ai SDK.
 * Gemini has a different content format — parts-based, not message-based.
 */

import "server-only";

import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  type Content,
} from "@google/generative-ai";

import { BaseAIProvider } from "@/services/ai/base-provider";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIMessage,
  AIModel,
  AIProviderName,
  AIStreamHandler,
  GeminiModel,
  TokenUsage,
} from "@/types/ai";

// ─── Safety Settings ──────────────────────────────────────────────────────────

// Default safety settings — permissive for professional use cases
const DEFAULT_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export class GeminiProvider extends BaseAIProvider {
  readonly name = AIProviderName.GEMINI;
  readonly supportedModels: AIModel[] = Object.values(GeminiModel);

  private readonly client: GoogleGenerativeAI;

  constructor(config: { apiKey: string; timeoutMs?: number; maxRetries?: number }) {
    super(config);
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  // ─── Complete ───────────────────────────────────────────────────────────────

  protected async _complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = (request.model ?? this.getDefaultModel()) as string;
    const { systemInstruction, history, lastMessage } = this.convertMessages(request.messages);

    try {
      const genModel = this.client.getGenerativeModel({
        model,
        systemInstruction,
        safetySettings: DEFAULT_SAFETY_SETTINGS,
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens,
          topP: request.topP,
        },
      });

      const chat = genModel.startChat({ history });
      const result = await chat.sendMessage(lastMessage);
      const response = result.response;
      const content = response.text();

      // Gemini returns token counts in usageMetadata
      const meta = response.usageMetadata;
      const usage: TokenUsage = {
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
        totalTokens: meta?.totalTokenCount ?? 0,
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
    const { systemInstruction, history, lastMessage } = this.convertMessages(request.messages);
    let fullContent = "";
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    try {
      const genModel = this.client.getGenerativeModel({
        model,
        systemInstruction,
        safetySettings: DEFAULT_SAFETY_SETTINGS,
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens,
        },
      });

      const chat = genModel.startChat({ history });
      const result = await chat.sendMessageStream(lastMessage);

      for await (const chunk of result.stream) {
        const delta = chunk.text();
        if (delta) {
          fullContent += delta;
          await onChunk({ type: "delta", content: delta });
        }
      }

      // Final response has usage metadata
      const finalResponse = await result.response;
      const meta = finalResponse.usageMetadata;
      usage = {
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
        totalTokens: meta?.totalTokenCount ?? 0,
      };

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
    const model = this.client.getGenerativeModel({ model: GeminiModel.GEMINI_15_FLASH });
    await model.generateContent("hi");
  }

  protected getDefaultModel(): AIModel {
    return GeminiModel.GEMINI_15_PRO;
  }

  // ─── Message Format Adapter ───────────────────────────────────────────────────

  /**
   * Converts our unified AIMessage[] to Gemini's Content[] format.
   * Gemini uses "user"/"model" roles (not "assistant") and parts-based content.
   */
  private convertMessages(messages: AIMessage[]): {
    systemInstruction: string | undefined;
    history: Content[];
    lastMessage: string;
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const systemInstruction =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join("\n\n")
        : undefined;

    // All messages except the last go into history
    const historyMessages = conversationMessages.slice(0, -1);
    const lastMsg = conversationMessages.at(-1);

    if (!lastMsg) {
      throw new Error("At least one user message is required");
    }

    const history: Content[] = historyMessages.map((m) => ({
      // Gemini uses "model" instead of "assistant"
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    return {
      systemInstruction,
      history,
      lastMessage: lastMsg.content,
    };
  }
}

// ─── Factory Function ─────────────────────────────────────────────────────────

export function createGeminiProvider(overrides?: {
  timeoutMs?: number;
  maxRetries?: number;
}): GeminiProvider | null {
  const { env } = require("@/config/env") as { env: { GEMINI_API_KEY?: string } };

  if (!env.GEMINI_API_KEY) {
    return null;
  }

  return new GeminiProvider({
    apiKey: env.GEMINI_API_KEY,
    ...overrides,
  });
}
