/**
 * Validation Utilities
 *
 * Zod-based request validation helpers.
 * Centralizing validation logic prevents duplication across route handlers.
 */

import { NextRequest } from "next/server";
import { z, ZodSchema } from "zod";

import { ValidationError } from "@/lib/errors";

// ─── Request Body Validation ──────────────────────────────────────────────────

/**
 * Parses and validates a JSON request body against a Zod schema.
 * Throws ValidationError on failure — caught by withErrorHandler.
 */
export async function parseRequestBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
): Promise<T> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError("Invalid JSON in request body", {
      body: ["Must be valid JSON"],
    });
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors as Record<string, string[]>;
    throw new ValidationError("Request validation failed", fieldErrors);
  }

  return result.data;
}

/**
 * Parses and validates URL search params against a Zod schema.
 */
export function parseSearchParams<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
): T {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(params);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors as Record<string, string[]>;
    throw new ValidationError("Invalid query parameters", fieldErrors);
  }

  return result.data;
}

// ─── Common Schemas ───────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().cuid("Invalid ID format"),
});

export const promptSchema = z.object({
  content: z
    .string()
    .min(1, "Prompt cannot be empty")
    .max(32_000, "Prompt exceeds maximum length of 32,000 characters"),
  model: z.string().optional(),
  systemPrompt: z.string().max(8_000).optional(),
});
