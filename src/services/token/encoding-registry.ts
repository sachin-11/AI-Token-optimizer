/**
 * Encoding Registry
 *
 * Maps AI models to their tiktoken encoding.
 *
 * Why this matters:
 * - Different model families use different tokenizers
 * - Using the wrong encoding gives wrong token counts
 * - GPT-4o uses o200k_base (newer, more efficient)
 * - GPT-3.5/4 use cl100k_base
 * - Claude and Gemini don't use tiktoken — we estimate for them
 *
 * Performance note:
 * - tiktoken encoders are expensive to initialize (~50ms)
 * - We cache them as singletons after first load
 */

import "server-only";

import type { TiktokenEncoding } from "@/types/tokenizer";
import { AIProviderName, type AIModel } from "@/types/ai";
import { modelRegistry } from "@/services/ai/model-registry";

// ─── Model → Encoding Map ─────────────────────────────────────────────────────

const MODEL_ENCODING_MAP: Record<string, TiktokenEncoding> = {
  // o200k_base — GPT-4o family (newer, larger vocabulary)
  "gpt-4o": "o200k_base",
  "gpt-4o-mini": "o200k_base",
  "gpt-4o-2024-05-13": "o200k_base",
  "gpt-4o-2024-08-06": "o200k_base",

  // cl100k_base — GPT-4 and GPT-3.5 family
  "gpt-4": "cl100k_base",
  "gpt-4-turbo": "cl100k_base",
  "gpt-4-turbo-preview": "cl100k_base",
  "gpt-4-32k": "cl100k_base",
  "gpt-3.5-turbo": "cl100k_base",
  "gpt-3.5-turbo-16k": "cl100k_base",
  "text-embedding-ada-002": "cl100k_base",
  "text-embedding-3-small": "cl100k_base",
  "text-embedding-3-large": "cl100k_base",

  // p50k_base — older Codex/davinci models
  "text-davinci-003": "p50k_base",
  "text-davinci-002": "p50k_base",
  "code-davinci-002": "p50k_base",
};

// ─── Encoding Registry ────────────────────────────────────────────────────────

export const encodingRegistry = {
  /**
   * Get the tiktoken encoding name for a model.
   * Returns null for non-OpenAI models (Claude, Gemini) — they need estimation.
   */
  getEncoding(model: AIModel): TiktokenEncoding | null {
    // Direct lookup first
    const direct = MODEL_ENCODING_MAP[model];
    if (direct) return direct;

    // Check provider — non-OpenAI models don't use tiktoken
    const info = modelRegistry.find(model);
    if (info && info.provider !== AIProviderName.OPENAI) {
      return null;
    }

    // Unknown OpenAI model — default to cl100k_base as safe fallback
    if (typeof model === "string" && model.startsWith("gpt-")) {
      return model.includes("4o") ? "o200k_base" : "cl100k_base";
    }

    return null;
  },

  /**
   * Check if a model has exact tiktoken support.
   */
  hasExactEncoding(model: AIModel): boolean {
    return this.getEncoding(model) !== null;
  },

  /**
   * Get all models that use a specific encoding.
   */
  getModelsForEncoding(encoding: TiktokenEncoding): string[] {
    return Object.entries(MODEL_ENCODING_MAP)
      .filter(([, enc]) => enc === encoding)
      .map(([model]) => model);
  },
} as const;
