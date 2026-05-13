/**
 * Security Headers
 *
 * Helmet-equivalent for Next.js — sets all recommended security headers.
 * Applied in middleware (Edge) so every response gets them.
 *
 * Headers implemented:
 * - Content-Security-Policy (CSP)
 * - Strict-Transport-Security (HSTS)
 * - X-Content-Type-Options
 * - X-Frame-Options
 * - X-XSS-Protection
 * - Referrer-Policy
 * - Permissions-Policy
 * - Cross-Origin-Opener-Policy
 * - Cross-Origin-Resource-Policy
 */

// ─── CSP Builder ──────────────────────────────────────────────────────────────

function buildCSP(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": isDev
      ? ["'self'", "'unsafe-eval'", "'unsafe-inline'"] // Next.js HMR needs these in dev
      : ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"], // Tailwind inline styles
    "img-src": ["'self'", "data:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "https://api.openai.com", "https://api.anthropic.com"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length > 0 ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

// ─── Header Sets ──────────────────────────────────────────────────────────────

export function getSecurityHeaders(isDev = false): Record<string, string> {
  return {
    // Prevent MIME type sniffing
    "X-Content-Type-Options": "nosniff",

    // Prevent clickjacking
    "X-Frame-Options": "DENY",

    // Legacy XSS protection (modern browsers use CSP)
    "X-XSS-Protection": "1; mode=block",

    // Control referrer information
    "Referrer-Policy": "strict-origin-when-cross-origin",

    // HSTS — force HTTPS (only in production)
    ...(isDev
      ? {}
      : {
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
        }),

    // CSP
    "Content-Security-Policy": buildCSP(isDev),

    // Prevent cross-origin window access
    "Cross-Origin-Opener-Policy": "same-origin",

    // Prevent cross-origin resource embedding
    "Cross-Origin-Resource-Policy": "same-origin",

    // Disable browser features we don't use
    "Permissions-Policy": [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),

    // Remove server fingerprint
    "X-Powered-By": "",
  };
}

/**
 * Apply security headers to a NextResponse.
 */
export function applySecurityHeaders(headers: Headers, isDev = false): void {
  const secHeaders = getSecurityHeaders(isDev);
  for (const [key, value] of Object.entries(secHeaders)) {
    if (value) headers.set(key, value);
    else headers.delete(key);
  }
}
