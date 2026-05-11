/**
 * Worker Registry
 *
 * Starts and stops all workers as a group.
 * Called from a dedicated worker process (not the Next.js server).
 *
 * Why separate process:
 * - Workers are long-running — they block the event loop
 * - Next.js server should stay lean and fast
 * - Workers can be scaled independently
 * - Crash isolation — a worker crash doesn't take down the web server
 *
 * In development: workers run in the same process for simplicity.
 * In production:  run `node src/workers/worker-process.ts` separately.
 */


import { createChildLogger } from "@/lib/logger";
import { OptimizationWorker } from "@/workers/optimization.worker";
import { AnalyticsWorker }    from "@/workers/analytics.worker";
import { EmbeddingWorker }    from "@/workers/embedding.worker";
import { CacheWarmingWorker } from "@/workers/cache-warming.worker";
import { CleanupWorker }      from "@/workers/cleanup.worker";
import { DeadLetterWorker }   from "@/workers/dead-letter.worker";

const log = createChildLogger({ module: "WorkerRegistry" });

// ─── Registry ─────────────────────────────────────────────────────────────────

const workers = {
  optimization: new OptimizationWorker(),
  analytics:    new AnalyticsWorker(),
  embedding:    new EmbeddingWorker(),
  cacheWarming: new CacheWarmingWorker(),
  cleanup:      new CleanupWorker(),
  deadLetter:   new DeadLetterWorker(),
};

export function startAllWorkers(): void {
  log.info("Starting all workers");

  workers.optimization.start();
  workers.analytics.start();
  workers.embedding.start();
  workers.cacheWarming.start();
  workers.cleanup.start();
  workers.deadLetter.start();

  log.info(`${Object.keys(workers).length} workers started`);
}

export async function stopAllWorkers(): Promise<void> {
  log.info("Stopping all workers");

  await Promise.all([
    workers.optimization.stop(),
    workers.analytics.stop(),
    workers.embedding.stop(),
    workers.cacheWarming.stop(),
    workers.cleanup.stop(),
    workers.deadLetter.stop(),
  ]);

  log.info("All workers stopped");
}

export { workers };
