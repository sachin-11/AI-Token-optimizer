/**
 * Standalone Worker Process
 *
 * Run this separately from the Next.js server:
 *   npx tsx src/workers/worker-process.ts
 *
 * Why separate process:
 * - BullMQ uses Node.js child_process/path — incompatible with webpack
 * - Workers are long-running — shouldn't share the web server process
 * - Can be scaled independently (more worker instances for heavy load)
 */

import { startAllWorkers, stopAllWorkers } from "./worker-registry";
import { registerScheduledJobs } from "./scheduler";
import { closeAllQueues } from "./queue-manager";

async function main() {
  console.log("🔧 Starting worker process...");

  // Register cron schedules
  await registerScheduledJobs();

  // Start all workers
  startAllWorkers();

  console.log("✅ Workers running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down workers...`);
    await stopAllWorkers();
    await closeAllQueues();
    console.log("Workers stopped.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT",  () => void shutdown("SIGINT"));
}

void main().catch((err) => {
  console.error("Worker process failed:", err);
  process.exit(1);
});
