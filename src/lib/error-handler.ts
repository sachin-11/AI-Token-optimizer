/**
 * Global Error Handler
 *
 * Centralizes error-to-response mapping for Route Handlers.
 * Every API route wraps its handler with this — no scattered try/catch.
 *
 * Pattern: withErrorHandler(handler) — higher-order function approach
 * avoids middleware complexity while keeping error handling DRY.
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { isDevelopment } from "@/config/env";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";
import { isAppError, ValidationError, RateLimitError } from "@/lib/errors";
import { createChildLogger } from "@/lib/logger";
import { ErrorCode } from "@/types/api";

const log = createChildLogger({ module: "ErrorHandler" });

// ─── Route Handler Wrapper ────────────────────────────────────────────────────

type RouteHandler = (
  req: NextRequest,
  context?: { params: Record<string, string> },
) => Promise<NextResponse>;

/**
 * Wraps a route handler with standardized error handling.
 *
 * @example
 * export const POST = withErrorHandler(async (req) => {
 *   const body = await req.json();
 *   // ... handler logic
 *   return successResponse(result);
 * });
 */
export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (error) {
      return handleError(error, req);
    }
  };
}

// ─── Error Mapping ────────────────────────────────────────────────────────────

export function handleError(error: unknown, req?: NextRequest): NextResponse {
  // Zod validation errors — from request body parsing
  if (error instanceof ZodError) {
    const fieldErrors = error.flatten().fieldErrors as Record<string, string[]>;
    log.warn({ fieldErrors, path: req?.nextUrl.pathname }, "Request validation failed");
    return validationErrorResponse(fieldErrors);
  }

  // ValidationError — from service layer
  if (error instanceof ValidationError) {
    log.warn({ fieldErrors: error.fieldErrors }, error.message);
    return validationErrorResponse(error.fieldErrors);
  }

  // RateLimitError — special handling for Retry-After header
  if (error instanceof RateLimitError) {
    log.warn({ retryAfterMs: error.retryAfterMs }, "Rate limit exceeded");
    const response = errorResponse(ErrorCode.RATE_LIMITED, error.message, {
      status: 429,
      details: { retryAfterMs: error.retryAfterMs },
    });
    response.headers.set("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)));
    return response;
  }

  // Known application errors
  if (isAppError(error)) {
    const logLevel = error.statusCode >= 500 ? "error" : "warn";
    log[logLevel](
      {
        code: error.code,
        statusCode: error.statusCode,
        context: error.context,
        err: error,
      },
      error.message,
    );

    return errorResponse(error.code, error.message, {
      status: error.statusCode,
      details: error.context,
      error: isDevelopment ? error : undefined,
    });
  }

  // Unknown errors — log full details, return generic message
  log.error({ err: error }, "Unhandled error in route handler");

  return errorResponse(
    ErrorCode.INTERNAL_ERROR,
    isDevelopment && error instanceof Error
      ? error.message
      : "An unexpected error occurred",
    {
      status: 500,
      error: isDevelopment && error instanceof Error ? error : undefined,
    },
  );
}

// ─── Server Action Error Handler ──────────────────────────────────────────────

/**
 * Wraps Server Actions with error handling.
 * Returns a typed result object instead of throwing — safer for client components.
 */
export async function withActionErrorHandler<T>(
  action: () => Promise<T>,
): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    const data = await action();
    return { data, error: null };
  } catch (error) {
    if (isAppError(error)) {
      log.warn({ code: error.code }, error.message);
      return { data: null, error: error.message };
    }

    log.error({ err: error }, "Unhandled error in server action");
    return {
      data: null,
      error: isDevelopment && error instanceof Error ? error.message : "Action failed",
    };
  }
}
