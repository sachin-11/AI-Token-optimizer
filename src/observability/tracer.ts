/**
 * Distributed Tracer
 *
 * Lightweight span-based tracing that works without the full OTel SDK.
 * Produces structured log entries that can be correlated by trace/span IDs.
 *
 * In production with a real OTel collector, replace the log-based exporter
 * with an OTLP exporter — the API surface stays identical.
 *
 * Trace context propagation:
 * - traceId  : unique per request chain (W3C traceparent format)
 * - spanId   : unique per operation within a trace
 * - parentId : links child spans to parent
 */

import "server-only";

import { nanoid } from "nanoid";
import { createChildLogger } from "@/lib/logger";
import { registry } from "@/observability/metrics";

const log = createChildLogger({ module: "Tracer" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentId?: string;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export type SpanStatus = "ok" | "error" | "unset";

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly startTime: number;

  setAttribute(key: string, value: string | number | boolean): this;
  setStatus(status: SpanStatus, message?: string): this;
  recordException(error: Error): this;
  end(): void;
  /** Create a child span within this trace */
  child(name: string, attributes?: SpanAttributes): Span;
}

// ─── Span Implementation ──────────────────────────────────────────────────────

class SpanImpl implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly startTime: number;

  private attributes: SpanAttributes = {};
  private status: SpanStatus = "unset";
  private statusMessage?: string;
  private ended = false;

  constructor(
    name: string,
    traceId: string,
    private readonly parentId?: string,
  ) {
    this.name = name;
    this.traceId = traceId;
    this.spanId = nanoid(16);
    this.startTime = Date.now();
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.attributes[key] = value;
    return this;
  }

  setStatus(status: SpanStatus, message?: string): this {
    this.status = status;
    this.statusMessage = message;
    return this;
  }

  recordException(error: Error): this {
    this.attributes["exception.type"]    = error.name;
    this.attributes["exception.message"] = error.message;
    this.status = "error";
    return this;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;

    const durationMs = Date.now() - this.startTime;

    // Emit structured log — correlatable by traceId
    const logEntry = {
      traceId:    this.traceId,
      spanId:     this.spanId,
      parentId:   this.parentId,
      name:       this.name,
      durationMs,
      status:     this.status,
      statusMsg:  this.statusMessage,
      ...this.attributes,
    };

    if (this.status === "error") {
      log.error(logEntry, `span:end [${this.name}]`);
    } else {
      log.debug(logEntry, `span:end [${this.name}]`);
    }

    // Record latency in histogram if it looks like an HTTP or AI span
    if (this.name.startsWith("http.")) {
      registry.observe("http_request_duration_ms", durationMs, {
        method: String(this.attributes["http.method"] ?? "unknown"),
        route:  String(this.attributes["http.route"]  ?? "unknown"),
        status: String(this.attributes["http.status"] ?? "unknown"),
      });
    }

    if (this.name.startsWith("ai.")) {
      registry.observe("ai_latency_ms", durationMs, {
        provider: String(this.attributes["ai.provider"] ?? "unknown"),
        model:    String(this.attributes["ai.model"]    ?? "unknown"),
      });
    }

    if (this.name.startsWith("optimization.")) {
      registry.observe("optimization_duration_ms", durationMs, {
        mode:   String(this.attributes["optimization.mode"]   ?? "unknown"),
        status: String(this.attributes["optimization.status"] ?? "unknown"),
      });
    }
  }

  child(name: string, attributes: SpanAttributes = {}): Span {
    const child = new SpanImpl(name, this.traceId, this.spanId);
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) child.setAttribute(k, v);
    }
    return child;
  }
}

// ─── Tracer ───────────────────────────────────────────────────────────────────

export class Tracer {
  /**
   * Start a new root span (new trace).
   */
  startSpan(name: string, attributes: SpanAttributes = {}): Span {
    const traceId = nanoid(32);
    const span = new SpanImpl(name, traceId);
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    log.debug({ traceId, spanId: span.spanId, name }, "span:start");
    return span;
  }

  /**
   * Continue an existing trace from propagated context.
   */
  continueTrace(name: string, ctx: SpanContext, attributes: SpanAttributes = {}): Span {
    const span = new SpanImpl(name, ctx.traceId, ctx.spanId);
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    return span;
  }

  /**
   * Wrap an async function in a span — auto-ends on completion/error.
   */
  async trace<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes: SpanAttributes = {},
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = await fn(span);
      span.setStatus("ok");
      return result;
    } catch (error) {
      if (error instanceof Error) span.recordException(error);
      span.setStatus("error");
      throw error;
    } finally {
      span.end();
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const tracer = new Tracer();
