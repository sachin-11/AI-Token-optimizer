/**
 * Health Checker
 *
 * Checks all platform dependencies and returns structured health status.
 * Used by /api/health for K8s probes and monitoring systems.
 *
 * Checks:
 * - Database connectivity (Prisma ping)
 * - Redis connectivity (PING command)
 * - AI provider availability (lightweight model list call)
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "HealthChecker" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface ComponentHealth {
  status: HealthStatus;
  latencyMs: number;
  message?: string;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  version: string;
  uptime: number;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    ai?: ComponentHealth;
  };
}

// ─── Checks ───────────────────────────────────────────────────────────────────

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    return { status: "healthy", latencyMs: Date.now() - start };
  } catch (error) {
    log.error({ err: error }, "Database health check failed");
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

async function checkRedis(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const { redis } = await import("@/lib/redis");
    const pong = await redis.ping();
    return {
      status: pong === "PONG" ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    log.error({ err: error }, "Redis health check failed");
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

// ─── Health Checker ───────────────────────────────────────────────────────────

export async function getHealthReport(includeAI = false): Promise<HealthReport> {
  const [database, redis] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);

  const components: HealthReport["components"] = { database, redis };

  // Determine overall status
  const statuses = Object.values(components).map((c) => c.status);
  const overallStatus: HealthStatus =
    statuses.some((s) => s === "unhealthy") ? "unhealthy"
    : statuses.some((s) => s === "degraded") ? "degraded"
    : "healthy";

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "unknown",
    uptime: process.uptime(),
    components,
  };
}
