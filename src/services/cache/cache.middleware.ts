/**
 * Cache Middleware
 *
 * Higher-order functions that wrap route handlers and server actions
 * with transparent caching. Callers don't need to know about cache internals.
 *
 * Two patterns:
 * 1. withResponseCache — wraps Next.js Route Handlers
 * 2. withActionCache   — wraps Server Actions
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { createChildLogger } from "@/lib/logger";
import { getCacheService } from "@/services/cache/cache.service";
import { CacheKeyFactory } from "@/services/cache/cache-key.factory";
import { TtlManager } from "@/services/cache/ttl-manager";
import type { CacheGetOptions, CacheSetOptions } from "@/types/cache";
import type { AICompletionResponse, AIModel } from "@/types/ai";

const log = createChildLogger({ module: "CacheMiddleware" });

// ─── Route Handler Cache Wrapper ──────────────────────────────────────────────

interface AICacheOptions extends CacheGetOptions, CacheSetOptions {
  /** Extract prompt from request — required */
  getPrompt: (req: NextRequest) => Promise<string> | string;
  /** Extract model from request */
  getModel?: (req: NextRequest) => AIModel;
  /** Default model if getModel not provided */
  defaultModel?: AIModel;
}

type RouteHandler = (req: NextRequest) => Promise<NextResponse>;

/**
 * Wraps a route handler with AI response caching.
 *
 * @example
 * export const POST = withAICache(
 *   async (req) => {
 *     const { prompt, model } = await req.json();
 *     const response = await router.complete({ messages: [{ role: 'user', content: prompt }], model });
 *     return NextResponse.json(response);
 *   },
 *   {
 *     getPrompt: async (req) => (await req.json()).prompt,
 *     getModel: async (req) => (await req.json()).model ?? 'gpt-4o',
 *   }
 * );
 */
export function withAICache(
  handler: RouteHandler,
  options: AICacheOptions,
): RouteHandler {
  return async (req: NextRequest) => {
    const cache = getCacheService();

    try {
      const prompt = await options.getPrompt(req);
      const model = options.getModel?.(req) ?? options.defaultModel ?? "gpt-4o";

      // Check cache before calling handler
      const cached = await cache.get(prompt, model, {
        skipSemantic: options.skipSemantic,
        similarityThreshold: options.similarityThreshold,
      });

      if (cached.hit) {
        log.debug({ model, tier: cached.tier }, "Route handler cache hit");
        return NextResponse.json(cached.entry.data, {
          headers: {
            "X-Cache": "HIT",
            "X-Cache-Tier": cached.tier ?? "unknown",
            "X-Cache-Similarity": String(cached.entry.similarity ?? 1),
          },
        });
      }

      // Cache miss — call the actual handler
      const response = await handler(req);

      // Try to extract and cache the AI response from the handler's response
      try {
        const cloned = response.clone();
        const body = await cloned.json() as { data?: AICompletionResponse };
        const aiResponse = body.data ?? (body as unknown as AICompletionResponse);

        if (aiResponse?.content) {
          void cache.set(prompt, model, aiResponse, {
            ttlSeconds: options.ttlSeconds,
            storeInSemanticCache: options.storeInSemanticCache,
          });
        }
      } catch {
        // Response parsing failure is non-fatal
      }

      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          "X-Cache": "MISS",
        },
      });
    } catch (error) {
      log.warn({ err: error }, "Cache middleware error — bypassing cache");
      return handler(req);
    }
  };
}

// ─── Server Action Cache Wrapper ──────────────────────────────────────────────

/**
 * Wraps a Server Action with cache-aside pattern.
 *
 * @example
 * const optimizePrompt = withActionCache(
 *   async (prompt: string, model: string) => {
 *     return router.complete({ messages: [{ role: 'user', content: prompt }], model });
 *   },
 *   { ttlSeconds: 3600 }
 * );
 */
export function withActionCache<TArgs extends [string, AIModel, ...unknown[]], TResult extends AICompletionResponse>(
  action: (...args: TArgs) => Promise<TResult>,
  options: CacheSetOptions & CacheGetOptions = {},
): (...args: TArgs) => Promise<TResult & { fromCache: boolean }> {
  return async (...args: TArgs) => {
    const [prompt, model] = args;
    const cache = getCacheService();

    const cached = await cache.get(prompt, model, options);
    if (cached.hit) {
      return { ...cached.entry.data, fromCache: true } as TResult & { fromCache: boolean };
    }

    const result = await action(...args);
    void cache.set(prompt, model, result, options);

    return { ...result, fromCache: false };
  };
}

// ─── Generic Value Cache ──────────────────────────────────────────────────────

/**
 * Cache any serializable value with a string key.
 * Use for non-AI responses (analytics, model lists, etc.)
 */
export const valueCache = {
  async get<T>(key: string): Promise<T | null> {
    const { redis } = await import("@/lib/redis");
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    const { redis } = await import("@/lib/redis");
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch {}
  },

  async del(key: string): Promise<void> {
    const { redis } = await import("@/lib/redis");
    try {
      await redis.del(key);
    } catch {}
  },

  /**
   * Get or compute — fetch from cache or run fn and store result.
   */
  async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds = 300,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await fn();
    void this.set(key, value, ttlSeconds);
    return value;
  },
} as const;
