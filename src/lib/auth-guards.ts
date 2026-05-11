/**
 * Auth Guards — Higher-Order Functions for Route Handlers
 *
 * Wrap route handlers with auth + RBAC enforcement.
 * Keeps handler code clean — no auth boilerplate inside business logic.
 *
 * Usage:
 *   export const POST = withAuth(handler);
 *   export const DELETE = withRole(UserRole.ADMIN)(handler);
 *   export const GET = withPermission(Permission.ANALYTICS_READ)(handler);
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth-utils";
import { requirePermission, requireRole } from "@/lib/rbac";
import { handleError } from "@/lib/error-handler";
import { Permission, UserRole, type AuthContext } from "@/types/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthedHandler = (
  req: NextRequest,
  ctx: AuthContext,
  params?: { params: Record<string, string> },
) => Promise<NextResponse>;

type RouteContext = { params: Record<string, string> };

// ─── withAuth ─────────────────────────────────────────────────────────────────

/**
 * Require any authenticated user (session or API key).
 */
export function withAuth(handler: AuthedHandler) {
  return async (req: NextRequest, ctx?: RouteContext): Promise<NextResponse> => {
    try {
      const auth = await resolveAuth();
      if (!auth) {
        return NextResponse.json(
          { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } },
          { status: 401 },
        );
      }
      return handler(req, auth, ctx);
    } catch (error) {
      return handleError(error, req);
    }
  };
}

// ─── withRole ─────────────────────────────────────────────────────────────────

/**
 * Require a minimum role level.
 */
export function withRole(requiredRole: UserRole) {
  return (handler: AuthedHandler) =>
    async (req: NextRequest, ctx?: RouteContext): Promise<NextResponse> => {
      try {
        const auth = await resolveAuth();
        if (!auth) {
          return NextResponse.json(
            { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } },
            { status: 401 },
          );
        }
        requireRole(auth.role, requiredRole);
        return handler(req, auth, ctx);
      } catch (error) {
        return handleError(error, req);
      }
    };
}

// ─── withPermission ───────────────────────────────────────────────────────────

/**
 * Require a specific permission.
 */
export function withPermission(permission: Permission) {
  return (handler: AuthedHandler) =>
    async (req: NextRequest, ctx?: RouteContext): Promise<NextResponse> => {
      try {
        const auth = await resolveAuth();
        if (!auth) {
          return NextResponse.json(
            { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } },
            { status: 401 },
          );
        }
        requirePermission(auth.role, permission);
        return handler(req, auth, ctx);
      } catch (error) {
        return handleError(error, req);
      }
    };
}

// ─── Convenience Exports ──────────────────────────────────────────────────────

export const withAdmin      = withRole(UserRole.ADMIN);
export const withSuperAdmin = withRole(UserRole.SUPER_ADMIN);
