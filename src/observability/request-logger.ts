/**
 * Request Logger
 *
 * Structured per-request logging with trace context.
 * Wraps route handlers to automatically log:
 * - Request metadata (method, path, user)
 * - Response status and latency
 * - Errors with full context
 *
 * Why structured logging over console.log:
 * - JSON output is parseable by log aggregators (Datadog, Loki, CloudWatch)
 * - Consistent fields enable dashboards and alerts
 * - Trace IDs link logs to distributed traces
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createChildLogger } from "@/lib/logger";
import { tracer } from "@/observability/tracer";
import { recordHttpRequest } from "@/observability/ai-metrics";

const log = createChildLogger({ module: "RequestLogger" });

// ─── Request Context ──────────────────────────────────────────────────────────

export interface RequestContext {
  requestId: string;
  traceId: string;
  method: string;
  path: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
}

export function extractRequestContext(req: NextRequest): RequestContext {
  return {
    requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
    traceId:   req.headers.get("x-trace-id")   ?? crypto.randomUUID(),
    method:    req.method,
    path:      req.nextUrl.pathname,
    ip:        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}

// ─── withRequestLogging HOF ───────────────────────────────────────────────────

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<NextResponse>;

/**
 * Wraps a route handler with structured request/response logging and metrics.
 *
 * @example
 * export const GET = withRequestLogging(async (req) => {
 *   return NextResponse.json({ ok: true });
 * });
 */
export function withRequestLogging(
  handler: RouteHandler,
  routeName?: string,
): RouteHandler {
  return async (req: NextRequest, ctx?: unknown): Promise<NextResponse> => {
    const context = extractRequestContext(req);
    const route = routeName ?? req.nextUrl.pathname;
    const startTime = Date.now();

    log.info(
      {
        requestId: context.requestId,
        traceId:   context.traceId,
        method:    context.method,
        path:      context.path,
        ip:        context.ip,
      },
      "→ request",
    );

    const span = tracer.startSpan(`http.${context.method.toLowerCase()}`, {
      "http.method":     context.method,
      "http.route":      route,
      "http.request_id": context.requestId,
    });

    try {
      const response = await handler(req, ctx);
      const durationMs = Date.now() - startTime;

      span
        .setAttribute("http.status", response.status)
        .setAttribute("http.duration_ms", durationMs)
        .setStatus(response.status < 400 ? "ok" : "error")
        .end();

      log.info(
        {
          requestId: context.requestId,
          traceId:   context.traceId,
          method:    context.method,
          path:      context.path,
          status:    response.status,
          durationMs,
        },
        "← response",
      );

      recordHttpRequest({
        method:    context.method,
        route,
        status:    response.status,
        durationMs,
      });

      // Inject trace headers into response
      response.headers.set("X-Request-Id", context.requestId);
      response.headers.set("X-Trace-Id",   context.traceId);

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (error instanceof Error) span.recordException(error);
      span.setStatus("error").end();

      log.error(
        {
          requestId: context.requestId,
          traceId:   context.traceId,
          method:    context.method,
          path:      context.path,
          durationMs,
          err:       error,
        },
        "← request error",
      );

      recordHttpRequest({ method: context.method, route, status: 500, durationMs });
      throw error;
    }
  };
}
