/**
 * AI Services — Public API
 *
 * Import from here, not from individual files.
 * This keeps internal structure flexible without breaking callers.
 */

export { getAIRouter, resetAIRouter, createAIRouterWithProviders } from "./ai-provider.factory";
export { AIRouterService } from "./ai-router.service";
export { modelRegistry } from "./model-registry";
export { FallbackEngine, DEFAULT_FALLBACK_CHAINS } from "./fallback-engine";
export { BaseAIProvider } from "./base-provider";
export { OpenAIProvider, createOpenAIProvider } from "./providers/openai.provider";
export { AnthropicProvider, createAnthropicProvider } from "./providers/anthropic.provider";
export { GeminiProvider, createGeminiProvider } from "./providers/gemini.provider";
