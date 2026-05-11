/**
 * API Throttle — Token Bucket Algorithm
 *
 * Complements the sliding window rate limiter.
 * Token bucket allows controlled bursting — better UX than hard limits.
 *
 * Difference from rate limiter:
 * - Rate limiter: "max N requests per window" (sliding window)
 * - Throttle: "max N concurrent + burst allowance" (token bucket)
 *
 * Use throttle for:
 * - AI endpoints (expensive, slow)
 * - Batch operations
 * - Endpoints with variable processing time
 */

import "server-only";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { RateLimitError } from "@/lib/errors";

const log = createChildLogger({ module: "APIThrottle" });

export interface ThrottleConfig {
  /** Max tokens in bucket */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
  /** Tokens consumed per request */
  tokensPerRequest: number;
  keyPrefix: string;
}

export const THROTTLE_PRESETS = {
  aiOptimize: {
    capacity: 10,
    refillRate: 0.5,      // 1 token per 2 seconds
    tokensPerRequest: 2,
    keyPrefix: "throttle:ai:optimize",
  },
  aiStream: {
    capacity: 5,
    refillRate: 0.2,      // 1 token per 5 seconds
    tokensPerRequest: 3,
    keyPrefix: "throttle:ai:stream",
  },
  batchProcess: {
    capacity: 3,
    refillRate: 0.1,
    tokensPerRequest: 1,
    keyPrefix: "throttle:batch",
  },
} as const satisfies Record<string, ThrottleConfig>;

export class APIThrottle {
  async consume(identifier: string, config: ThrottleConfig): Promise<{
    allowed: boolean;
    tokensRemaining: number;
    retryAfterMs: number;
  }> {
    const key = `${config.keyPrefix}:${identifier}`;
    const now = Date.now() / 1000; // seconds

    try {
      // Lua script for atomic token bucket
      const script = `
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refill_rate = tonumber(ARGV[2])
        local tokens_per_req = tonumber(ARGV[3])
        local now = tonumber(ARGV[4])

        local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
        local tokens = tonumber(bucket[1]) or capacity
        local last_refill = tonumber(bucket[2]) or now

        -- Refill tokens based on elapsed time
        local elapsed = now - last_refill
        tokens = math.min(capacity, tokens + elapsed * refill_rate)

        if tokens >= tokens_per_req then
          tokens = tokens - tokens_per_req
          redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
          redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)
          return {1, math.floor(tokens * 100)}
        else
          redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
          redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)
          local wait = math.ceil((tokens_per_req - tokens) / refill_rate * 1000)
          return {0, wait}
        end
      `;

      const result = await redis.eval(
        script, 1, key,
        String(config.capacity),
        String(config.refillRate),
        String(config.tokensPerRequest),
        String(now),
      ) as [number, number];

      const allowed = result[0] === 1;
      const value = result[1] ?? 0;

      return {
        allowed,
        tokensRemaining: allowed ? Math.floor(value / 100) : 0,
        retryAfterMs: allowed ? 0 : value,
      };
    } catch (error) {
      log.error({ err: error, key }, "Throttle error — failing open");
      return { allowed: true, tokensRemaining: 1, retryAfterMs: 0 };
    }
  }

  async enforce(identifier: string, config: ThrottleConfig): Promise<void> {
    const result = await this.consume(identifier, config);
    if (!result.allowed) {
      throw new RateLimitError(result.retryAfterMs);
    }
  }
}

let instance: APIThrottle | null = null;
export function getAPIThrottle(): APIThrottle {
  instance ??= new APIThrottle();
  return instance;
}
