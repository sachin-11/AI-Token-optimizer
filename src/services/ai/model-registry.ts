/**
 * Model Registry
 *
 * Single source of truth for all AI model metadata.
 * Centralizing this means cost calculations, context window checks,
 * and capability queries all read from one place — no scattered constants.
 */

import "server-only";

import {
  AIModel,
  AIProviderName,
  AnthropicModel,
  GeminiModel,
  ModelInfo,
  OpenAIModel,
} from "@/types/ai";

// ─── Registry Definition ──────────────────────────────────────────────────────

const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // ── OpenAI ──────────────────────────────────────────────────────────────────
  [OpenAIModel.GPT_4O]: {
    id: OpenAIModel.GPT_4O,
    provider: AIProviderName.OPENAI,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputCostPerMToken: 2.5,
    outputCostPerMToken: 10.0,
    supportsStreaming: true,
    supportsVision: true,
  },
  [OpenAIModel.GPT_4O_MINI]: {
    id: OpenAIModel.GPT_4O_MINI,
    provider: AIProviderName.OPENAI,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputCostPerMToken: 0.15,
    outputCostPerMToken: 0.6,
    supportsStreaming: true,
    supportsVision: true,
  },
  [OpenAIModel.GPT_4_TURBO]: {
    id: OpenAIModel.GPT_4_TURBO,
    provider: AIProviderName.OPENAI,
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    inputCostPerMToken: 10.0,
    outputCostPerMToken: 30.0,
    supportsStreaming: true,
    supportsVision: true,
  },
  [OpenAIModel.GPT_35_TURBO]: {
    id: OpenAIModel.GPT_35_TURBO,
    provider: AIProviderName.OPENAI,
    contextWindow: 16_385,
    maxOutputTokens: 4_096,
    inputCostPerMToken: 0.5,
    outputCostPerMToken: 1.5,
    supportsStreaming: true,
    supportsVision: false,
  },

  // ── Anthropic ────────────────────────────────────────────────────────────────
  [AnthropicModel.CLAUDE_35_SONNET]: {
    id: AnthropicModel.CLAUDE_35_SONNET,
    provider: AIProviderName.ANTHROPIC,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputCostPerMToken: 3.0,
    outputCostPerMToken: 15.0,
    supportsStreaming: true,
    supportsVision: true,
  },
  [AnthropicModel.CLAUDE_3_HAIKU]: {
    id: AnthropicModel.CLAUDE_3_HAIKU,
    provider: AIProviderName.ANTHROPIC,
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    inputCostPerMToken: 0.25,
    outputCostPerMToken: 1.25,
    supportsStreaming: true,
    supportsVision: true,
  },
  [AnthropicModel.CLAUDE_3_OPUS]: {
    id: AnthropicModel.CLAUDE_3_OPUS,
    provider: AIProviderName.ANTHROPIC,
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    inputCostPerMToken: 15.0,
    outputCostPerMToken: 75.0,
    supportsStreaming: true,
    supportsVision: true,
  },

  // ── Gemini ───────────────────────────────────────────────────────────────────
  [GeminiModel.GEMINI_15_PRO]: {
    id: GeminiModel.GEMINI_15_PRO,
    provider: AIProviderName.GEMINI,
    contextWindow: 2_000_000,
    maxOutputTokens: 8_192,
    inputCostPerMToken: 1.25,
    outputCostPerMToken: 5.0,
    supportsStreaming: true,
    supportsVision: true,
  },
  [GeminiModel.GEMINI_15_FLASH]: {
    id: GeminiModel.GEMINI_15_FLASH,
    provider: AIProviderName.GEMINI,
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    inputCostPerMToken: 0.075,
    outputCostPerMToken: 0.3,
    supportsStreaming: true,
    supportsVision: true,
  },
  [GeminiModel.GEMINI_10_PRO]: {
    id: GeminiModel.GEMINI_10_PRO,
    provider: AIProviderName.GEMINI,
    contextWindow: 32_760,
    maxOutputTokens: 2_048,
    inputCostPerMToken: 0.5,
    outputCostPerMToken: 1.5,
    supportsStreaming: true,
    supportsVision: false,
  },
};

// ─── Registry API ─────────────────────────────────────────────────────────────

export const modelRegistry = {
  /**
   * Get full model info. Throws if model is unknown.
   */
  get(model: AIModel): ModelInfo {
    const info = MODEL_REGISTRY[model];
    if (!info) {
      throw new Error(`Unknown model: "${model}". Register it in model-registry.ts`);
    }
    return info;
  },

  /**
   * Get model info without throwing — returns undefined if not found.
   */
  find(model: AIModel): ModelInfo | undefined {
    return MODEL_REGISTRY[model];
  },

  /**
   * Get all models for a specific provider.
   */
  getByProvider(provider: AIProviderName): ModelInfo[] {
    return Object.values(MODEL_REGISTRY).filter((m) => m.provider === provider);
  },

  /**
   * Get all registered models.
   */
  getAll(): ModelInfo[] {
    return Object.values(MODEL_REGISTRY);
  },

  /**
   * Calculate cost for a given token usage.
   */
  calculateCost(
    model: AIModel,
    inputTokens: number,
    outputTokens: number,
  ): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number; currency: "USD" } {
    const info = this.get(model);
    const inputCostUsd = (inputTokens / 1_000_000) * info.inputCostPerMToken;
    const outputCostUsd = (outputTokens / 1_000_000) * info.outputCostPerMToken;
    return {
      inputCostUsd: Number(inputCostUsd.toFixed(8)),
      outputCostUsd: Number(outputCostUsd.toFixed(8)),
      totalCostUsd: Number((inputCostUsd + outputCostUsd).toFixed(8)),
      currency: "USD",
    };
  },

  /**
   * Check if a token count fits within a model's context window.
   */
  fitsInContext(model: AIModel, tokenCount: number): boolean {
    const info = this.get(model);
    return tokenCount <= info.contextWindow;
  },

  /**
   * Register a custom model at runtime (for fine-tuned models etc.)
   */
  register(info: ModelInfo): void {
    MODEL_REGISTRY[info.id] = info;
  },
} as const;
