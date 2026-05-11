/**
 * API Response Utilities
 *
 * Centralized response builders ensure every endpoint returns
 * the same envelope shape. This is critical for:
 * - Frontend error handling consistency
 * - API contract stability
 * - Monitoring/alerting on error codes
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { isDevelopment } from "@/config/env";
import {
  ApiErrorResponse,
  ApiSuccessResponse,
  ErrorCode,
  PaginationMeta,
  ResponseMeta,
  TokenUsageMeta,
} from "@/types/api";

// ─── Success Responses ────────────────────────────────────────────────────────

export function successResponse<T>(
  data: T,
  options?: {
    status?: number;
    meta?: Partial<ResponseMeta>;
  },
): NextResponse<ApiSuccessResponse<T>> {
  const meta: ResponseMeta = {
    requestId: nanoid(),
    timestamp: new Date().toISOString(),
    ...options?.meta,
  };

  return NextResponse.json(
    { success: true, data, meta },
    { status: options?.status ?? 200 },
  );
}

export function paginatedResponse<T>(
  data: T,
  pagination: PaginationMeta,
  tokenUsage?: TokenUsageMeta,
): NextResponse<ApiSuccessResponse<T>> {
  return successResponse(data, {
    meta: { pagination, tokenUsage },
  });
}

// ─── Error Responses ──────────────────────────────────────────────────────────

export function errorResponse(
  code: ErrorCode,
  message: string,
  options?: {
    status?: number;
    details?: Record<string, unknown>;
    error?: Error;
    requestId?: string;
  },
): NextResponse<ApiErrorResponse> {
  const httpStatus = options?.status ?? errorCodeToHttpStatus(code);

  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        details: options?.details,
        // Only expose stack traces in development
        ...(isDevelopment && options?.error && { stack: options.error.stack }),
      },
      requestId: options?.requestId ?? nanoid(),
    },
    { status: httpStatus },
  );
}

export function validationErrorResponse(
  details: Record<string, string[]>,
  requestId?: string,
): NextResponse<ApiErrorResponse> {
  return errorResponse(ErrorCode.VALIDATION_ERROR, "Request validation failed", {
    status: 400,
    details,
    requestId,
  });
}

export function notFoundResponse(
  resource: string,
  requestId?: string,
): NextResponse<ApiErrorResponse> {
  return errorResponse(ErrorCode.NOT_FOUND, `${resource} not found`, {
    status: 404,
    requestId,
  });
}

export function unauthorizedResponse(requestId?: string): NextResponse<ApiErrorResponse> {
  return errorResponse(ErrorCode.UNAUTHORIZED, "Authentication required", {
    status: 401,
    requestId,
  });
}

export function rateLimitedResponse(
  retryAfterMs: number,
  requestId?: string,
): NextResponse<ApiErrorResponse> {
  const response = errorResponse(
    ErrorCode.RATE_LIMITED,
    "Too many requests. Please slow down.",
    { status: 429, details: { retryAfterMs }, requestId },
  );
  response.headers.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  return response;
}

// ─── HTTP Status Mapping ──────────────────────────────────────────────────────

function errorCodeToHttpStatus(code: ErrorCode): number {
  const statusMap: Partial<Record<ErrorCode, number>> = {
    [ErrorCode.VALIDATION_ERROR]: 400,
    [ErrorCode.UNAUTHORIZED]: 401,
    [ErrorCode.FORBIDDEN]: 403,
    [ErrorCode.NOT_FOUND]: 404,
    [ErrorCode.CONFLICT]: 409,
    [ErrorCode.RATE_LIMITED]: 429,
    [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
    [ErrorCode.AI_CONTEXT_TOO_LONG]: 422,
    [ErrorCode.AI_CONTENT_FILTERED]: 422,
    [ErrorCode.TOKEN_LIMIT_EXCEEDED]: 422,
    [ErrorCode.AI_QUOTA_EXCEEDED]: 429,
    [ErrorCode.AI_PROVIDER_ERROR]: 502,
    [ErrorCode.DATABASE_ERROR]: 503,
    [ErrorCode.SERVICE_UNAVAILABLE]: 503,
    [ErrorCode.QUEUE_ERROR]: 503,
    [ErrorCode.INTERNAL_ERROR]: 500,
  };

  return statusMap[code] ?? 500;
}
