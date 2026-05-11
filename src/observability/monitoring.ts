/**
 * Monitoring Utilities
 *
 * Reusable helpers for timing, error tracking, and performance monitoring.
 * Import these in services and route handlers for consistent instrumentation.
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { tracer } from "@/observability/tracer";
import { registry } from "@/observability/metrics";

const log = createChildLogger({ module: "Monitoring" });

// ─── Timer ────────────────────────────────────────────────────────────────────

/**
 * Simple high-resolution timer.
 *
 * @example
 * const timer = startTimer();
 * await doWork();
 * const ms = timer.end();
 */
export function startTimer() {
  const start = Date.now();
  return {
    end: () => Date.now() - start,
    elapsed: () => Date.now() - start,
  };
}

// ─── Timed Execution ──────────────────────────────────────────────────────────

/**
 * Execute a function and log its duration.
 *
 * @example
 * const result = await timed("compress-prompt", () => compressor.compress(text));
 */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const timer = startTimer();
  try {
    const result = await fn();
    const ms = timer.end();
    log.debug({ label, durationMs: ms, ...metadata }, `timed:ok`);
    return result;
  } catch (error) {
    const ms = timer.end();
    log.warn({ label, durationMs: ms, err: error, ...metadata }, `timed:error`);
    throw error;
  }
}

// ─── Traced Execution ─────────────────────────────────────────────────────────

/**
 * Execute a function within a named span.
 * Combines timing + structured logging + trace context.
 *
 * @example
 * const result = await traced("ai.completion", () => provider.complete(req), {
 *   "ai.model": "gpt-4o",
 *   "ai.provider": "openai",
 * });
 */
export async function traced<T>(
  spanName: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return tracer.trace(spanName, async (span) => {
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) {
        span.setAttribute(k, v);
      }
    }
    return fn();
  });
}

// ─── Error Tracker ────────────────────────────────────────────────────────────

/**
 * Record an error with full context for alerting.
 */
export function trackError(
  error: Error,
  context: {
    operation: string;
    userId?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  },
): void {
  log.error(
    {
      err:       error,
      operation: context.operation,
      userId:    context.userId,
      requestId: context.requestId,
      ...context.metadata,
    },
    `error:${context.operation}`,
  );

  registry.inc("http_errors_total", { operation: context.operation });
}

// ─── Performance Budget ───────────────────────────────────────────────────────

/**
 * Assert that an operation completes within a time budget.
 * Logs a warning if exceeded — useful for SLA monitoring.
 *
 * @example
 * const check = performanceBudget("ai-completion", 5000);
 * await doWork();
 * check.assert(); // warns if > 5000ms
 */
export function performanceBudget(label: string, budgetMs: number) {
  const start = Date.now();
  return {
    assert() {
      const elapsed = Date.now() - start;
      if (elapsed > budgetMs) {
        log.warn(
          { label, elapsed, budget: budgetMs, overBy: elapsed - budgetMs },
          "performance-budget:exceeded",
        );
      }
      return elapsed;
    },
  };
}

// ─── Latency Percentiles ──────────────────────────────────────────────────────

/**
 * Calculate p50/p95/p99 from an array of latency samples.
 */
export function calculatePercentiles(samples: number[]): {
  p50: number; p95: number; p99: number; avg: number; min: number; max: number;
} {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };

  const sorted = [...samples].sort((a, b) => a - b);
  const p = (pct: number) => sorted[Math.floor(sorted.length * pct)] ?? 0;

  return {
    p50: p(0.50),
    p95: p(0.95),
    p99: p(0.99),
    avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}
