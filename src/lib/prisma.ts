/**
 * Prisma Client Singleton
 *
 * Why singleton pattern:
 * - Next.js hot reload creates new module instances in development
 * - Without singleton, each reload creates a new DB connection pool
 * - This pattern reuses the existing client across hot reloads
 *
 * In production, module caching handles this naturally.
 */

import { PrismaClient } from "@prisma/client";

import { isDevelopment } from "@/config/env";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "PrismaClient" });

// Extend global type to hold the Prisma instance across hot reloads
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: isDevelopment
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "error" },
          { emit: "event", level: "warn" },
        ]
      : [
          { emit: "event", level: "error" },
        ],
  });
}

const prisma = globalThis.__prisma ?? createPrismaClient();

if (isDevelopment) {
  globalThis.__prisma = prisma;

  // Log slow queries in development for performance awareness
  prisma.$on("query", (e) => {
    if (e.duration > 100) {
      log.warn({ duration: e.duration, query: e.query }, "Slow query detected");
    }
  });
}

prisma.$on("error", (e) => {
  log.error({ message: e.message }, "Prisma error");
});

export { prisma };
export type { PrismaClient };
