/**
 * Auth Utilities — Server-side helpers
 *
 * Reusable functions for getting the current session,
 * validating API keys, and building auth context.
 */

import "server-only";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserRepository } from "@/repositories/user.repository";
import { UnauthorizedError } from "@/lib/errors";
import { UserRole, type AuthContext, type ApiKeyContext } from "@/types/auth";

// ─── Session Helpers ──────────────────────────────────────────────────────────

/**
 * Get current session — returns null if not authenticated.
 */
export async function getSession() {
  return auth();
}

/**
 * Get current session and throw if not authenticated.
 */
export async function requireSession(): Promise<NonNullable<Awaited<ReturnType<typeof auth>>>> {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();
  return session;
}

/**
 * Build a typed AuthContext from the current session.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    userId: session.user.id,
    email:  session.user.email ?? "",
    role:   session.user.role  ?? UserRole.USER,
    apiKey: session.user.apiKey ?? "",
  };
}

/**
 * Get auth context and throw if not authenticated.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

// ─── API Key Auth ─────────────────────────────────────────────────────────────

/**
 * Validate an API key from the X-Api-Key header.
 * Used for programmatic API access (not browser sessions).
 */
export async function validateApiKey(apiKey: string): Promise<ApiKeyContext | null> {
  if (!apiKey || apiKey.length < 10) return null;

  const user = await getUserRepository().findByApiKey(apiKey);
  if (!user) return null;

  return {
    userId: user.id,
    email:  user.email,
    role:   user.role as UserRole,
  };
}

/**
 * Extract API key from request headers.
 */
export async function getApiKeyFromHeaders(): Promise<string | null> {
  const headersList = await headers();
  return (
    headersList.get("x-api-key") ??
    headersList.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

/**
 * Resolve auth from either session OR API key.
 * API key takes precedence (for programmatic access).
 */
export async function resolveAuth(): Promise<AuthContext | null> {
  // Try API key first
  const apiKey = await getApiKeyFromHeaders();
  if (apiKey) {
    const apiCtx = await validateApiKey(apiKey);
    if (apiCtx) {
      return { ...apiCtx, apiKey };
    }
  }

  // Fall back to session
  return getAuthContext();
}

/**
 * Resolve auth and throw if neither session nor API key is valid.
 */
export async function requireResolvedAuth(): Promise<AuthContext> {
  const ctx = await resolveAuth();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}
