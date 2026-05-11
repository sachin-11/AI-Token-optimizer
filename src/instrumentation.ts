/**
 * Next.js Instrumentation Hook
 *
 * Runs ONCE before the app starts — Node.js runtime only.
 *
 * NOTE: BullMQ workers are NOT started here.
 * Workers use Node.js child_process/path internals that webpack can't bundle.
 * Run workers separately: `npx tsx src/workers/worker-process.ts`
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 1. Logger
  const { logger } = await import("./lib/logger");
  logger.info(
    {
      service: process.env.OTEL_SERVICE_NAME ?? "ai-prompt-optimizer",
      env:     process.env.NODE_ENV,
      version: process.env.npm_package_version ?? "unknown",
    },
    "🚀 Platform starting",
  );

  // 2. Telemetry
  const { initTelemetry } = await import("./lib/telemetry");
  initTelemetry();

  // 3. Pre-warm tiktoken encoders (non-blocking, non-fatal)
  import("./services/token/tiktoken-cache")
    .then(({ warmEncoders }) => warmEncoders())
    .catch(() => { /* encoders initialize on first use */ });

  // 4. Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received — shutting down gracefully");
    const { shutdownTelemetry } = await import("./lib/telemetry");
    await shutdownTelemetry();
    process.exit(0);
  });
}
