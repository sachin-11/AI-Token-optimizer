/**
 * Logger Module — SERVER ONLY
 *
 * Pino-based structured logging with:
 * - JSON output for log aggregators (Datadog, Loki, CloudWatch)
 * - Automatic secret redaction
 * - Child loggers with bound context (module, requestId, traceId)
 * - Pretty printing in development
 */

import "server-only";

import pino from "pino";
import { env, isDevelopment } from "@/config/env";

// ─── Logger Factory ───────────────────────────────────────────────────────────

function createLogger() {
  const baseConfig: pino.LoggerOptions = {
    level: env.LOG_LEVEL,

    // Redact sensitive fields — never log secrets
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.apiKey",
        "*.password",
        "*.secret",
        "*.token",
        "*.accessToken",
        "*.refreshToken",
      ],
      censor: "[REDACTED]",
    },

    // Standard fields on every log line
    base: {
      service: env.OTEL_SERVICE_NAME,
      env:     env.NODE_ENV,
      pid:     process.pid,
    },

    timestamp: pino.stdTimeFunctions.isoTime,

    serializers: {
      err:   pino.stdSerializers.err,
      error: pino.stdSerializers.err,
      req:   pino.stdSerializers.req,
      res:   pino.stdSerializers.res,
    },
  };

  if (isDevelopment) {
    return pino({
      ...baseConfig,
      transport: {
        target: "pino-pretty",
        options: {
          colorize:      true,
          translateTime: "SYS:standard",
          ignore:        "pid,hostname,service,env",
          messageFormat: "{module} | {msg}",
        },
      },
    });
  }

  return pino(baseConfig);
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const logger = createLogger();

// ─── Child Logger Factories ───────────────────────────────────────────────────

/**
 * Create a child logger with module-level context.
 * All logs from this logger include the module name.
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Create a request-scoped logger.
 * Binds requestId + traceId so all logs in a request are correlatable.
 */
export function createRequestLogger(
  requestId: string,
  traceId?: string,
  userId?: string,
) {
  return logger.child({
    requestId,
    ...(traceId && { traceId }),
    ...(userId  && { userId }),
  });
}

/**
 * Create a workflow-scoped logger for agent tracing.
 */
export function createWorkflowLogger(
  requestId: string,
  workflowId: string,
  userId?: string,
) {
  return logger.child({
    requestId,
    workflowId,
    ...(userId && { userId }),
  });
}

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type Logger      = pino.Logger;
export type ChildLogger = ReturnType<typeof createChildLogger>;
