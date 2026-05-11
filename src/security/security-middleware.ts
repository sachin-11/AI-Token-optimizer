/**
 * Security Middleware — Route Handler HOFs
 *
 * Composable security wrappers for API route handlers.
 * Stack them like middleware:
 *
 *   export const POST = withSecurity({
 *     rateLimit: RATE_LIMIT_PRESETS.aiOptimize,
 *     throttle: THROTTLE_PRESETS.aiOptimize,
 *     validateBody: optimizeRequestSchema,
 *     scanInjection: true,
 *   })(handler);
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ZodSchema } from "zod";

import { getRateLimiter, RATE_LIMIT_PRESETS, type RateLimitConfig } from "@/security/rate-limiter";
import { getAPIThrottle, THROTTLE_PRESETS, type ThrottleConfig } from "@/security/api-throttle";
import { getRequestValidator } from "@/security/request-validator";
import { scanForInjection } from "@/security/prompt-injection";
import { handleError } from "@/lib/error-handler";
import { createChildLogger } from "@/lib/logger";
import { resolveAuth } from "@/lib/auth-utils";
import type { AuthContext } from "@/types/auth";

const log = createChildLogger({ module: "SecurityMiddleware" });

// ─── Types ────────────────────────────────────────────────────────────────────

type SecuredHandler<TBody = unknown> = (
  req: NextRequest,
  context: { auth: AuthContext | null; body: TBody; requestId: string },
) => Promise<NextResponse>;

export interface SecurityOptions<TBody = unknown> {
  /** Rate limit config — defaults to user preset */
  rateLimit?: RateLimitConfig | false;
  /** Token bucket throttle */
  throttle?: ThrottleConfig | false;
  /** Zod schema for body validation */
  validateBody?: ZodSchema<TBody>;
  /** Scan prompt fields for injection attacks */
  scanInjection?: boolean | string[];  // true = scan all strings, string[] = field names
  /** Require authentication */
  requireAuth?: boolean;
  /** Max payload size */
  payloadSize?: "default" | "aiRequest" | "upload";
}

// ─── withSecurity ─────────────────────────────────────────────────────────────

export function withSecurity<TBody = unknown>(options: SecurityOptions<TBody> = {}) {
  return (handler: SecuredHandler<TBody>) =>
    async (req: NextRequest): Promise<NextResponse> => {
      const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

      try {
        const validator = getRequestValidator();

        // ── 1. Payload size check ──────────────────────────────────────────
        validator.validateSize(req, options.payloadSize ?? "default");

        // ── 2. Content-Type check ──────────────────────────────────────────
        validator.validateContentType(req);

        // ── 3. Query param injection scan ─────────────────────────────────
        validator.validateQueryParams(req);

        // ── 4. Auth resolution ─────────────────────────────────────────────
        const auth = await resolveAuth();

        if (options.requireAuth && !auth) {
          return NextResponse.json(
            { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } },
            { status: 401 },
          );
        }

        // ── 5. Rate limiting ───────────────────────────────────────────────
        if (options.rateLimit !== false) {
          const rlConfig = options.rateLimit ?? RATE_LIMIT_PRESETS.user;
          const rlKey = auth?.userId ?? getClientIp(req);
          const rlResult = await getRateLimiter().check(rlKey, rlConfig);

          if (!rlResult.allowed) {
            return NextResponse.json(
              { success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } },
              {
                status: 429,
                headers: {
                  "Retry-After": String(Math.ceil(rlResult.retryAfterMs / 1000)),
                  "X-RateLimit-Limit": String(rlResult.limit),
                  "X-RateLimit-Remaining": "0",
                  "X-RateLimit-Reset": String(rlResult.resetMs),
                },
              },
            );
          }

          // Attach rate limit headers to response (set later)
          req.headers.set("x-rl-remaining", String(rlResult.remaining));
          req.headers.set("x-rl-limit", String(rlResult.limit));
        }

        // ── 6. Throttle ────────────────────────────────────────────────────
        if (options.throttle) {
          const throttleKey = auth?.userId ?? getClientIp(req);
          const throttleResult = await getAPIThrottle().consume(throttleKey, options.throttle);

          if (!throttleResult.allowed) {
            return NextResponse.json(
              { success: false, error: { code: "RATE_LIMITED", message: "Request throttled — please wait" } },
              {
                status: 429,
                headers: { "Retry-After": String(Math.ceil(throttleResult.retryAfterMs / 1000)) },
              },
            );
          }
        }

        // ── 7. Body validation ─────────────────────────────────────────────
        let body = undefined as TBody;
        if (options.validateBody && ["POST", "PUT", "PATCH"].includes(req.method)) {
          body = await validator.validateBody(req, options.validateBody);
        }

        // ── 8. Prompt injection scan ───────────────────────────────────────
        if (options.scanInjection && body) {
          const fieldsToScan = Array.isArray(options.scanInjection)
            ? options.scanInjection
            : getStringFields(body);

          for (const field of fieldsToScan) {
            const value = (body as Record<string, unknown>)[field];
            if (typeof value === "string") {
              const scan = scanForInjection(value);
              if (scan.riskLevel === "critical") {
                log.warn({ field, riskLevel: scan.riskLevel, requestId }, "Prompt injection blocked");
                return NextResponse.json(
                  { success: false, error: { code: "VALIDATION_ERROR", message: "Request contains disallowed content" } },
                  { status: 400 },
                );
              }
              // For high risk — sanitize and continue (don't block)
              if (scan.riskLevel === "high" && body) {
                (body as Record<string, unknown>)[field] = scan.sanitizedContent;
              }
            }
          }
        }

        // ── 9. Call handler ────────────────────────────────────────────────
        const response = await handler(req, { auth, body, requestId });

        // Attach rate limit headers to response
        const remaining = req.headers.get("x-rl-remaining");
        const limit = req.headers.get("x-rl-limit");
        if (remaining) response.headers.set("X-RateLimit-Remaining", remaining);
        if (limit)     response.headers.set("X-RateLimit-Limit", limit);

        return response;
      } catch (error) {
        return handleError(error, req);
      }
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function getStringFields(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .filter(([, v]) => typeof v === "string")
    .map(([k]) => k);
}

// ─── Convenience Presets ──────────────────────────────────────────────────────

/** Standard API endpoint security */
export const withApiSecurity = withSecurity({
  rateLimit: RATE_LIMIT_PRESETS.user,
  requireAuth: true,
});

/** AI optimization endpoint — strict rate limit + throttle + injection scan */
export const withAISecurity = <TBody>(schema: ZodSchema<TBody>) =>
  withSecurity<TBody>({
    rateLimit: RATE_LIMIT_PRESETS.aiOptimize,
    throttle: THROTTLE_PRESETS.aiOptimize,
    validateBody: schema,
    scanInjection: true,
    requireAuth: true,
    payloadSize: "aiRequest",
  });
