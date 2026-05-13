/**
 * Redis Client Singleton
 *
 * Provider: Upstash Redis (rediss:// TLS, port 6380)
 * Protocol: TCP via ioredis — compatible with BullMQ + all existing cache services
 *
 * Upstash-specific tuning:
 * - enableAutoPipelining: batches multiple commands in one round-trip (free tier friendly)
 * - maxRetriesPerRequest: 3 — retries transient network errors
 * - connectTimeout: 10s — Upstash serverless instances can have cold starts
 * - tls: enabled automatically via rediss:// protocol in the URL
 *
 * On Vercel (serverless):
 * - Each function invocation may create a new TCP connection
 * - Upstash free tier allows 100 concurrent connections — sufficient for most workloads
 * - BullMQ workers use `redisQueue` but run outside Vercel (npm run workers)
 */

import Redis, { type RedisOptions } from "ioredis";

import { env } from "@/config/env";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "RedisClient" });

// ─── Configuration ────────────────────────────────────────────────────────────

const isUpstash = env.REDIS_URL.includes("upstash.io");

const redisConfig: RedisOptions = {
  // Retry with exponential back-off, capped at 2 s
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 2000),

  // Upstash instances can take a moment to wake from idle
  connectTimeout: 10_000,

  // Auto-pipeline: transparently batch commands issued in the same event-loop tick.
  // Reduces round-trips and stays within Upstash free-tier command limits.
  enableAutoPipelining: isUpstash,

  // Upstash TLS is handled by the rediss:// scheme in REDIS_URL.
  // Explicitly set tls:{} only when the URL doesn't carry the scheme info.
  ...(isUpstash && { tls: {} }),

  enableReadyCheck: !isUpstash, // Upstash doesn't support the PING ready-check
  lazyConnect: false,
};

// ─── Client Factory ───────────────────────────────────────────────────────────

function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, redisConfig);

  client.on("connect", () => log.info({ client: name }, "Redis connected"));
  client.on("ready", () => log.debug({ client: name }, "Redis ready"));
  client.on("error", (err) => log.error({ client: name, err }, "Redis error"));
  client.on("close", () => log.warn({ client: name }, "Redis connection closed"));
  client.on("reconnecting", () => log.info({ client: name }, "Redis reconnecting…"));

  return client;
}

// ─── Singleton Clients ────────────────────────────────────────────────────────

/** Main client — used by all cache services, rate limiter, embedding cache */
export const redis = createRedisClient("main");

/** Queue client — used exclusively by BullMQ (runs outside Vercel) */
export const redisQueue = createRedisClient("queue");

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export async function disconnectRedis(): Promise<void> {
  await Promise.all([redis.quit(), redisQueue.quit()]);
  log.info("Redis clients disconnected");
}

export type { Redis };
