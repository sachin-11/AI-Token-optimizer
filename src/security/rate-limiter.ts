/**
 * Redis-backed Rate Limiter
 *
 * Sliding window algorithm — more accurate than fixed window.
 * Uses a sorted set per key: member = requestId, score = timestamp.
 *
 * Why sliding window over fixed window:
 * - Fixed window allows 2x burst at window boundary
 * - Sliding window enforces consistent rate at all times
 *
 * Tiers:
 * - GLOBAL   : per-IP, catches bots before auth
 * - USER     : per-userId, prevents API abuse by authenticated users
 * - ENDPOINT : per-route, protects expensive endpoints (AI calls)
 */

import "server-only";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { RateLimitError } from "@/lib/errors";

const log = createChildLogger({ module: "RateLimiter" });

// ─── Config ───────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key prefix for namespacing */
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;       // Unix ms when window resets
  retryAfterMs: number;  // How long to wait if blocked
}

// ─── Preset Configs ───────────────────────────────────────────────────────────

export const RATE_LIMIT_PRESETS = {
  // Global IP-based — catches bots, DDoS
  global: { limit: 200, windowMs: 60_000, keyPrefix: "rl:global" },

  // Authenticated user — general API
  user: { limit: 100, windowMs: 60_000, keyPrefix: "rl:user" },

  // AI optimization endpoint — expensive, strict
  aiOptimize: { limit: 20, windowMs: 60_000, keyPrefix: "rl:ai:optimize" },

  // Auth endpoints — prevent brute force
  auth: { limit: 10, windowMs: 60_000, keyPrefix: "rl:auth" },

  // Analytics — read-heavy, more lenient
  analytics: { limit: 300, windowMs: 60_000, keyPrefix: "rl:analytics" },
} as const satisfies Record<string, RateLimitConfig>;

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

export class RateLimiter {
  /**
   * Check and increment rate limit for a key.
   * Uses Redis sorted set sliding window.
   */
  async check(identifier: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const key = `${config.keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Atomic pipeline: remove expired, add current, count
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);          // Remove expired entries
      pipeline.zadd(key, now, `${now}-${Math.random()}`);      // Add current request
      pipeline.zcard(key);                                      // Count in window
      pipeline.pexpire(key, config.windowMs);                   // Auto-expire key

      const results = await pipeline.exec();
      const count = (results?.[2]?.[1] as number) ?? 0;

      const remaining = Math.max(0, config.limit - count);
      const allowed = count <= config.limit;
      const resetMs = now + config.windowMs;
      const retryAfterMs = allowed ? 0 : config.windowMs;

      if (!allowed) {
        log.warn({ key, count, limit: config.limit }, "Rate limit exceeded");
      }

      return { allowed, limit: config.limit, remaining, resetMs, retryAfterMs };
    } catch (error) {
      // Redis failure → fail open (allow request) to avoid outage
      log.error({ err: error, key }, "Rate limiter Redis error — failing open");
      return { allowed: true, limit: config.limit, remaining: 1, resetMs: now + config.windowMs, retryAfterMs: 0 };
    }
  }

  /**
   * Check rate limit and throw RateLimitError if exceeded.
   */
  async enforce(identifier: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const result = await this.check(identifier, config);
    if (!result.allowed) {
      throw new RateLimitError(result.retryAfterMs);
    }
    return result;
  }

  /**
   * Reset rate limit for a key (e.g. after successful auth).
   */
  async reset(identifier: string, config: RateLimitConfig): Promise<void> {
    const key = `${config.keyPrefix}:${identifier}`;
    await redis.del(key);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: RateLimiter | null = null;
export function getRateLimiter(): RateLimiter {
  instance ??= new RateLimiter();
  return instance;
}
