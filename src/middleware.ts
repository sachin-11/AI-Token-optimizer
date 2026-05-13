/**
 * Next.js Edge Middleware
 *
 * Execution order (every request):
 * 1. Security headers
 * 2. Bot detection
 * 3. Scanner probe detection
 * 4. CORS
 * 5. Auth + RBAC
 */

import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { authConfig } from "@/lib/auth.config";
import { UserRole } from "@/types/auth";
import { applySecurityHeaders } from "@/security/security-headers";
import { detectBot, isSecurityScanner } from "@/security/bot-protection";

// ─── Route Config ─────────────────────────────────────────────────────────────

const PROTECTED_PREFIXES = ["/dashboard", "/api/v1"];
const ADMIN_PREFIXES = ["/admin", "/api/v1/admin"];
const PUBLIC_PATHS = new Set([
  "/",
  "/auth/signin",
  "/auth/signout",
  "/auth/error",
  "/api/auth",
  "/api/health",
]);

const isDev = process.env.NODE_ENV === "development";

// ─── Middleware ───────────────────────────────────────────────────────────────

const { auth } = NextAuth(authConfig);

export default auth(
  async (req: NextRequest & { auth?: { user?: { id?: string; role?: string } } }) => {
    const { pathname } = req.nextUrl;
    const requestId = nanoid(12);

    // Generate a fresh nonce for every request.
    // Next.js reads `x-nonce` from the response headers and stamps it onto
    // every <script> it renders, so nonce-based CSP works with hydration.
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

    const response = NextResponse.next({
      request: { headers: new Headers(req.headers) },
    });

    // ── 1. Security headers (every response) ──────────────────────────────────
    applySecurityHeaders(response.headers, isDev, nonce);
    response.headers.set("X-Request-Id", requestId);
    // Expose nonce to Next.js so it can stamp <script nonce="..."> tags
    response.headers.set("x-nonce", nonce);

    // ── 2. Scanner probe detection ─────────────────────────────────────────────
    if (isSecurityScanner(pathname)) {
      return new NextResponse(null, { status: 404 });
    }

    // ── 3. Bot detection (API routes only — don't block page crawlers) ─────────
    if (pathname.startsWith("/api/v1")) {
      const botCheck = detectBot(req.headers, req.method, pathname);
      if (botCheck.isBot && botCheck.confidence > 0.8) {
        return NextResponse.json(
          {
            success: false,
            error: { code: "FORBIDDEN", message: "Automated requests not allowed" },
          },
          { status: 403 },
        );
      }
    }

    // ── 4. CORS ────────────────────────────────────────────────────────────────
    if (pathname.startsWith("/api/")) {
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? "*";
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Api-Key, X-Request-Id",
      );
      response.headers.set("Access-Control-Allow-Credentials", "true");

      if (req.method === "OPTIONS") {
        return new NextResponse(null, { status: 204, headers: response.headers });
      }
    }

    // ── 5. Public path — skip auth ─────────────────────────────────────────────
    if (isPublicPath(pathname)) return response;

    // ── 6. Auth + RBAC ────────────────────────────────────────────────────────
    const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
    const isAdminRoute = ADMIN_PREFIXES.some((p) => pathname.startsWith(p));

    if (isProtected || isAdminRoute) {
      const session = (req as NextRequest & { auth?: { user?: { id?: string; role?: string } } })
        .auth;

      if (!session?.user?.id) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } },
            { status: 401, headers: response.headers },
          );
        }
        const url = new URL("/auth/signin", req.url);
        url.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(url);
      }

      if (isAdminRoute) {
        const role = session.user.role as UserRole;
        if (role !== UserRole.ADMIN && role !== UserRole.SUPER_ADMIN) {
          if (pathname.startsWith("/api/")) {
            return NextResponse.json(
              { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
              { status: 403, headers: response.headers },
            );
          }
          return NextResponse.redirect(new URL("/dashboard", req.url));
        }
      }
    }

    return response;
  },
);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (/\.(ico|png|jpg|jpeg|svg|css|js|woff2?)$/.test(pathname)) return true;
  return false;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
