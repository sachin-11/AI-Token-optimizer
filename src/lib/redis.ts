/**
 * Redis Client Singleton
 *
 * Used for:
 * - BullMQ job queues
 * - Response caching
 * - Rate limiting
 * - Session storage
 */

import Redis, { RedisOptions } from "ioredis";

import { env } from "@/config/env";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "RedisClient" });

// ─── Configuration ────────────────────────────────────────────────────────────

const redisConfig: RedisOptions = {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  enableReadyCheck: true,
  lazyConnect: false,
};

// ─── Client Factory ───────────────────────────────────────────────────────────

function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    ...redisConfig,
    ...(env.REDIS_PASSWORD && { password: env.REDIS_PASSWORD }),
  });

  client.on("connect", () => {
    log.info({ client: name }, "Redis connected");
  });

  client.on("error", (error) => {
    log.error({ client: name, err: error }, "Redis error");
  });

  client.on("close", () => {
    log.warn({ client: name }, "Redis connection closed");
  });

  return client;
}

// ─── Singleton Clients ────────────────────────────────────────────────────────

// Main client for general caching
export const redis = createRedisClient("main");

// Separate client for BullMQ — avoids blocking issues
export const redisQueue = createRedisClient("queue");

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export async function disconnectRedis(): Promise<void> {
  await Promise.all([redis.quit(), redisQueue.quit()]);
  log.info("Redis clients disconnected");
}

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type { Redis };
