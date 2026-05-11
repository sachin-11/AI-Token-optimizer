/**
 * Async Utility Functions
 *
 * Reusable patterns for retry logic, timeouts, and concurrency control.
 * These are critical for AI workloads where provider calls can fail transiently.
 */

import pRetry, { AbortError } from "p-retry";
import pLimit from "p-limit";

// ─── Retry with Exponential Backoff ───────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Retries an async operation with exponential backoff.
 * Use for AI provider calls, database operations, external APIs.
 *
 * @example
 * const result = await withRetry(() => openai.chat.completions.create(...), {
 *   maxAttempts: 3,
 *   onRetry: (err, attempt) => log.warn({ attempt }, 'Retrying AI call'),
 * });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1_000,
    maxDelayMs = 30_000,
    onRetry,
  } = options;

  return pRetry(fn, {
    retries: maxAttempts - 1,
    minTimeout: initialDelayMs,
    maxTimeout: maxDelayMs,
    factor: 2,
    onFailedAttempt: (error) => {
      onRetry?.(error, error.attemptNumber);
    },
  });
}

/**
 * Marks an error as non-retryable.
 * Use for validation errors, auth errors — no point retrying these.
 */
export function nonRetryable(error: Error): never {
  throw new AbortError(error);
}

// ─── Timeout Wrapper ──────────────────────────────────────────────────────────

/**
 * Wraps a promise with a timeout.
 * Essential for AI calls that can hang indefinitely.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = "Operation timed out",
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
  );

  return Promise.race([promise, timeoutPromise]);
}

// ─── Concurrency Limiter ──────────────────────────────────────────────────────

/**
 * Creates a concurrency-limited executor.
 * Use when processing batches of prompts to avoid overwhelming AI providers.
 *
 * @example
 * const limit = createConcurrencyLimit(5);
 * const results = await Promise.all(
 *   prompts.map(p => limit(() => optimizePrompt(p)))
 * );
 */
export function createConcurrencyLimit(concurrency: number) {
  return pLimit(concurrency);
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Safe Async ───────────────────────────────────────────────────────────────

/**
 * Wraps a promise to return [error, data] tuple — Go-style error handling.
 * Avoids deeply nested try/catch blocks.
 *
 * @example
 * const [error, result] = await safeAsync(fetchData());
 * if (error) return handleError(error);
 */
export async function safeAsync<T>(
  promise: Promise<T>,
): Promise<[Error, null] | [null, T]> {
  try {
    const data = await promise;
    return [null, data];
  } catch (error) {
    return [error instanceof Error ? error : new Error(String(error)), null];
  }
}
