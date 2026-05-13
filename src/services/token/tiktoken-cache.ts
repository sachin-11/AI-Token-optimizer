/**
 * Tiktoken Encoder Cache
 *
 * Why caching encoders:
 * - `get_encoding()` from tiktoken loads a WASM module + vocabulary file
 * - First call takes ~50-100ms and ~5MB memory per encoding
 * - Subsequent calls with the same encoding should reuse the instance
 * - Without caching, every token count request would pay this cost
 *
 * This is a module-level singleton — lives for the lifetime of the process.
 * In Next.js, this means it persists across requests on the same worker.
 */

import "server-only";

import type { Tiktoken } from "tiktoken";
import type { TiktokenEncoding } from "@/types/tokenizer";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "TiktokenCache" });

// ─── Encoder Cache ────────────────────────────────────────────────────────────

// Map of encoding name → initialized encoder instance
const encoderCache = new Map<TiktokenEncoding, Tiktoken>();

// Track initialization promises to prevent duplicate concurrent loads
const initPromises = new Map<TiktokenEncoding, Promise<Tiktoken>>();

/**
 * Get or initialize a tiktoken encoder for the given encoding.
 * Thread-safe: concurrent calls for the same encoding share one init promise.
 */
export async function getEncoder(encoding: TiktokenEncoding): Promise<Tiktoken> {
  // Return cached instance immediately
  const cached = encoderCache.get(encoding);
  if (cached) return cached;

  // If already initializing, wait for that promise
  const existing = initPromises.get(encoding);
  if (existing) return existing;

  // Start initialization
  const initPromise = initializeEncoder(encoding);
  initPromises.set(encoding, initPromise);

  try {
    const encoder = await initPromise;
    encoderCache.set(encoding, encoder);
    initPromises.delete(encoding);
    return encoder;
  } catch (error) {
    initPromises.delete(encoding);
    throw error;
  }
}

/**
 * Synchronous encoder access — only works if already cached.
 * Use for hot paths where async overhead matters.
 */
export function getEncoderSync(encoding: TiktokenEncoding): Tiktoken | null {
  return encoderCache.get(encoding) ?? null;
}

/**
 * Pre-warm the most common encoders at startup.
 * Call this in instrumentation.ts to avoid cold-start latency on first request.
 */
export async function warmEncoders(): Promise<void> {
  const commonEncodings: TiktokenEncoding[] = ["o200k_base", "cl100k_base"];

  await Promise.all(
    commonEncodings.map(async (encoding) => {
      try {
        await getEncoder(encoding);
        log.info({ encoding }, "Encoder warmed");
      } catch (error) {
        log.warn({ encoding, err: error }, "Failed to warm encoder");
      }
    }),
  );
}

/**
 * Free encoder memory — call on graceful shutdown.
 */
export function freeEncoders(): void {
  for (const [encoding, encoder] of encoderCache.entries()) {
    try {
      encoder.free();
      log.debug({ encoding }, "Encoder freed");
    } catch {
      // Ignore errors during cleanup
    }
  }
  encoderCache.clear();
}

// ─── Private ──────────────────────────────────────────────────────────────────

async function initializeEncoder(encoding: TiktokenEncoding): Promise<Tiktoken> {
  const start = Date.now();

  // Dynamic import — tiktoken is heavy, only load when needed
  const { get_encoding } = await import("tiktoken");
  const encoder = get_encoding(encoding);

  log.info({ encoding, initMs: Date.now() - start }, "Tiktoken encoder initialized");
  return encoder;
}
