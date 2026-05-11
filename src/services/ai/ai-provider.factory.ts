/**
 * AI Provider Factory — Dependency Injection Container
 *
 * Why a factory instead of direct instantiation:
 * - Centralizes provider initialization — one place to configure all providers
 * - Singleton pattern prevents creating multiple clients per request
 * - Easy to swap providers in tests (inject mocks)
 * - Gracefully handles optional providers (Anthropic, Gemini may not be configured)
 *
 * Usage:
 *   const router = getAIRouter();
 *   const response = await router.complete({ messages, model });
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { AIRouterService } from "@/services/ai/ai-router.service";
import { createOpenAIProvider } from "@/services/ai/providers/openai.provider";
import { createAnthropicProvider } from "@/services/ai/providers/anthropic.provider";
import { createGeminiProvider } from "@/services/ai/providers/gemini.provider";
import { AIProviderName, IAIProvider } from "@/types/ai";

const log = createChildLogger({ module: "AIProviderFactory" });

// ─── Singleton ────────────────────────────────────────────────────────────────

let routerInstance: AIRouterService | null = null;

/**
 * Returns the singleton AIRouterService.
 * Initializes all configured providers on first call.
 *
 * Providers are only registered if their API keys are present in env.
 * This allows running with just OpenAI configured, for example.
 */
export function getAIRouter(): AIRouterService {
  if (routerInstance) return routerInstance;

  const providers = new Map<AIProviderName, IAIProvider>();

  // ── OpenAI (required) ──────────────────────────────────────────────────────
  try {
    const openai = createOpenAIProvider();
    providers.set(AIProviderName.OPENAI, openai);
    log.info("OpenAI provider registered");
  } catch (error) {
    log.error({ err: error }, "Failed to initialize OpenAI provider");
    // OpenAI is required — rethrow
    throw error;
  }

  // ── Anthropic (optional) ───────────────────────────────────────────────────
  try {
    const anthropic = createAnthropicProvider();
    if (anthropic) {
      providers.set(AIProviderName.ANTHROPIC, anthropic);
      log.info("Anthropic provider registered");
    } else {
      log.info("Anthropic provider skipped — ANTHROPIC_API_KEY not set");
    }
  } catch (error) {
    log.warn({ err: error }, "Failed to initialize Anthropic provider — skipping");
  }

  // ── Gemini (optional) ──────────────────────────────────────────────────────
  try {
    const gemini = createGeminiProvider();
    if (gemini) {
      providers.set(AIProviderName.GEMINI, gemini);
      log.info("Gemini provider registered");
    } else {
      log.info("Gemini provider skipped — GEMINI_API_KEY not set");
    }
  } catch (error) {
    log.warn({ err: error }, "Failed to initialize Gemini provider — skipping");
  }

  log.info(
    { providers: Array.from(providers.keys()) },
    `AI Router initialized with ${providers.size} provider(s)`,
  );

  routerInstance = new AIRouterService(providers);
  return routerInstance;
}

/**
 * Reset the singleton — used in tests to inject mock providers.
 */
export function resetAIRouter(): void {
  routerInstance = null;
}

/**
 * Create a router with custom providers — for testing.
 */
export function createAIRouterWithProviders(
  providers: Map<AIProviderName, IAIProvider>,
): AIRouterService {
  return new AIRouterService(providers);
}
