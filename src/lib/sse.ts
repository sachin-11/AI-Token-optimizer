/**
 * SSE (Server-Sent Events) Utilities
 *
 * Why SSE over WebSockets for streaming AI responses:
 * - Unidirectional (server → client) — perfect for AI output
 * - Works over standard HTTP — no upgrade handshake
 * - Automatic reconnection built into the browser EventSource API
 * - Simpler than WebSockets for this use case
 * - Works with Next.js Route Handlers natively via ReadableStream
 */

import { nanoid } from "nanoid";
import type { SSEEnvelope, SSEEventType } from "@/types/streaming";

// ─── SSE Encoder ─────────────────────────────────────────────────────────────

/**
 * Encode a typed SSE event into the wire format.
 * Format: "id: ...\nevent: ...\ndata: ...\n\n"
 */
export function encodeSSE<T>(type: SSEEventType, data: T): string {
  const envelope: SSEEnvelope<T> = {
    id: nanoid(8),
    type,
    data,
    timestamp: new Date().toISOString(),
  };
  return `id: ${envelope.id}\nevent: ${type}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/**
 * Encode a heartbeat to keep the connection alive.
 * Browsers close SSE connections after ~30s of silence.
 */
export function encodeHeartbeat(): string {
  return `: heartbeat ${Date.now()}\n\n`;
}

// ─── SSE Stream Builder ───────────────────────────────────────────────────────

export interface SSEStreamOptions {
  /** Heartbeat interval in ms — keeps connection alive */
  heartbeatIntervalMs?: number;
  /** Signal to abort the stream */
  signal?: AbortSignal;
}

/**
 * Creates a ReadableStream that emits SSE-formatted events.
 * The generator function yields encoded SSE strings.
 *
 * @example
 * const stream = createSSEStream(async function* (emit) {
 *   emit('progress', { message: 'Starting...' });
 *   await doWork();
 *   emit('complete', { result });
 * });
 * return new Response(stream, { headers: SSE_HEADERS });
 */
export function createSSEStream(
  generator: (emit: <T>(type: SSEEventType, data: T) => void) => Promise<void>,
  options: SSEStreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const { heartbeatIntervalMs = 15_000, signal } = options;

  return new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try { controller.close(); } catch { /* already closed */ }
      };

      // Heartbeat to prevent connection timeout
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeHeartbeat()));
        } catch {
          close();
        }
      }, heartbeatIntervalMs);

      // Abort signal support
      signal?.addEventListener("abort", close);

      const emit = <T>(type: SSEEventType, data: T) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSSE(type, data)));
        } catch {
          close();
        }
      };

      try {
        await generator(emit);
      } catch (error) {
        emit("error", {
          message: error instanceof Error ? error.message : "Stream error",
          retryable: false,
        });
      } finally {
        close();
      }
    },
  });
}

// ─── SSE Response Headers ─────────────────────────────────────────────────────

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",  // Disable Nginx buffering
} as const;
