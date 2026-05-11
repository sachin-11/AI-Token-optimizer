/**
 * Request Validator
 *
 * Validates incoming requests for:
 * - Payload size limits (prevent memory exhaustion)
 * - Content-Type enforcement
 * - Request body sanitization
 * - SQL/NoSQL injection patterns in query params
 * - Path traversal attempts
 */

import "server-only";

import { NextRequest } from "next/server";
import { z, ZodSchema } from "zod";
import { ValidationError } from "@/lib/errors";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "RequestValidator" });

// ─── Size Limits ──────────────────────────────────────────────────────────────

const SIZE_LIMITS = {
  default:      1 * 1024 * 1024,   // 1MB
  aiRequest:    2 * 1024 * 1024,   // 2MB (prompts can be large)
  upload:      10 * 1024 * 1024,   // 10MB
} as const;

// ─── Dangerous Patterns ───────────────────────────────────────────────────────

const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
  /(--|;|\/\*|\*\/|xp_|sp_)/,
  /(\bOR\b\s+\d+\s*=\s*\d+|\bAND\b\s+\d+\s*=\s*\d+)/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.%2F/i,
  /%2e%2e%2f/i,
  /\.\.%5C/i,
];

const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["'][^"']*["']/i,
  /<iframe/i,
];

// ─── Validator ────────────────────────────────────────────────────────────────

export class RequestValidator {
  /**
   * Validate request size.
   */
  validateSize(
    req: NextRequest,
    limitType: keyof typeof SIZE_LIMITS = "default",
  ): void {
    const contentLength = req.headers.get("content-length");
    if (!contentLength) return; // Can't check without content-length

    const size = parseInt(contentLength, 10);
    const limit = SIZE_LIMITS[limitType];

    if (size > limit) {
      throw new ValidationError("Request payload too large", {
        size: [`Payload ${size} bytes exceeds limit of ${limit} bytes`],
      });
    }
  }

  /**
   * Enforce Content-Type for POST/PUT/PATCH.
   */
  validateContentType(req: NextRequest, expected = "application/json"): void {
    if (!["POST", "PUT", "PATCH"].includes(req.method)) return;

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes(expected)) {
      throw new ValidationError("Invalid Content-Type", {
        "content-type": [`Expected ${expected}, got ${contentType || "none"}`],
      });
    }
  }

  /**
   * Scan query parameters for injection patterns.
   */
  validateQueryParams(req: NextRequest): void {
    const params = req.nextUrl.searchParams.toString();
    if (!params) return;

    const decodedParams = decodeURIComponent(params);

    if (SQL_INJECTION_PATTERNS.some((p) => p.test(decodedParams))) {
      log.warn({ params: params.slice(0, 100) }, "SQL injection pattern in query params");
      throw new ValidationError("Invalid query parameters", {
        query: ["Contains disallowed patterns"],
      });
    }

    if (PATH_TRAVERSAL_PATTERNS.some((p) => p.test(decodedParams))) {
      log.warn({ params: params.slice(0, 100) }, "Path traversal attempt in query params");
      throw new ValidationError("Invalid query parameters", {
        query: ["Contains disallowed path patterns"],
      });
    }
  }

  /**
   * Validate and parse request body with Zod schema.
   * Includes XSS scanning on string fields.
   */
  async validateBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      throw new ValidationError("Invalid request body", {
        body: ["Must be valid JSON"],
      });
    }

    // Scan string values for XSS
    this.scanForXSS(body);

    const result = schema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors as Record<string, string[]>;
      throw new ValidationError("Validation failed", fieldErrors);
    }

    return result.data;
  }

  /**
   * Recursively scan object for XSS patterns.
   */
  private scanForXSS(value: unknown, path = "body"): void {
    if (typeof value === "string") {
      if (XSS_PATTERNS.some((p) => p.test(value))) {
        log.warn({ path, preview: value.slice(0, 50) }, "XSS pattern detected");
        throw new ValidationError("Invalid input", {
          [path]: ["Contains disallowed HTML/script content"],
        });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => this.scanForXSS(item, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        this.scanForXSS(val, `${path}.${key}`);
      }
    }
  }
}

let instance: RequestValidator | null = null;
export function getRequestValidator(): RequestValidator {
  instance ??= new RequestValidator();
  return instance;
}
