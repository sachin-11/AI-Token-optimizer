/**
 * API Response Type Definitions
 *
 * Standardized response envelope ensures:
 * - Consistent client-side error handling
 * - Predictable response shape across all endpoints
 * - Easy integration with monitoring/alerting
 */

// ─── Response Envelope ────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiError;
  requestId?: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// ─── Meta & Pagination ────────────────────────────────────────────────────────

export interface ResponseMeta {
  requestId?: string;
  timestamp: string;
  pagination?: PaginationMeta;
  tokenUsage?: TokenUsageMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface TokenUsageMeta {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  // Only included in development for debugging
  stack?: string;
}

export enum ErrorCode {
  // Client errors (4xx)
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  RATE_LIMITED = "RATE_LIMITED",
  PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE",

  // AI-specific errors
  AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR",
  AI_CONTEXT_TOO_LONG = "AI_CONTEXT_TOO_LONG",
  AI_CONTENT_FILTERED = "AI_CONTENT_FILTERED",
  AI_QUOTA_EXCEEDED = "AI_QUOTA_EXCEEDED",
  TOKEN_LIMIT_EXCEEDED = "TOKEN_LIMIT_EXCEEDED",

  // Server errors (5xx)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  DATABASE_ERROR = "DATABASE_ERROR",
  CACHE_ERROR = "CACHE_ERROR",
  QUEUE_ERROR = "QUEUE_ERROR",
}

// ─── Pagination Input ─────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  pageSize: number;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export interface StreamChunk {
  type: "delta" | "done" | "error";
  content?: string;
  tokenCount?: number;
  error?: string;
}
