/**
 * Application Error Classes
 *
 * Custom error hierarchy allows:
 * - Typed error handling in catch blocks
 * - Automatic HTTP status code mapping
 * - Structured error context for logging
 * - Clean separation between operational and programmer errors
 */

import { ErrorCode } from "@/types/api";

// ─── Base Application Error ───────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
      isOperational?: boolean;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = options?.isOperational ?? true;
    this.context = options?.context;

    // Maintains proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Domain-Specific Errors ───────────────────────────────────────────────────

export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]>) {
    super(message, ErrorCode.VALIDATION_ERROR, 400);
    this.fieldErrors = fieldErrors;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      ErrorCode.NOT_FOUND,
      404,
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, ErrorCode.UNAUTHORIZED, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Insufficient permissions") {
    super(message, ErrorCode.FORBIDDEN, 403);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Rate limit exceeded", ErrorCode.RATE_LIMITED, 429);
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── AI-Specific Errors ───────────────────────────────────────────────────────

export class AIProviderError extends AppError {
  public readonly provider: string;
  public readonly model: string;

  constructor(
    message: string,
    provider: string,
    model: string,
    cause?: Error,
  ) {
    super(message, ErrorCode.AI_PROVIDER_ERROR, 502, { cause });
    this.provider = provider;
    this.model = model;
  }
}

export class TokenLimitError extends AppError {
  public readonly tokenCount: number;
  public readonly limit: number;

  constructor(tokenCount: number, limit: number) {
    super(
      `Token count ${tokenCount} exceeds limit of ${limit}`,
      ErrorCode.TOKEN_LIMIT_EXCEEDED,
      422,
      { context: { tokenCount, limit } },
    );
    this.tokenCount = tokenCount;
    this.limit = limit;
  }
}

export class AIQuotaExceededError extends AppError {
  constructor(provider: string) {
    super(
      `AI provider quota exceeded for ${provider}`,
      ErrorCode.AI_QUOTA_EXCEEDED,
      429,
    );
  }
}

// ─── Infrastructure Errors ────────────────────────────────────────────────────

export class DatabaseError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.DATABASE_ERROR, 503, {
      cause,
      isOperational: false,
    });
  }
}

export class CacheError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.CACHE_ERROR, 503, { cause });
  }
}

export class QueueError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.QUEUE_ERROR, 503, { cause });
  }
}

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isOperationalError(error: unknown): boolean {
  if (isAppError(error)) return error.isOperational;
  return false;
}
