/**
 * Security Headers
 *
 * Applied in Edge Middleware on every response.
 *
 * CSP strategy — nonce-based (Next.js recommended approach):
 *   - Middleware generates a fresh crypto nonce per request.
 *   - CSP uses `'nonce-<value>' 'strict-dynamic'` for script-src.
 *   - Next.js reads the `x-nonce` response header and stamps the nonce onto
 *     every <script> tag it renders, so hydration + chunk loading work.
 *   - `'strict-dynamic'` propagates trust to scripts loaded by nonce'd scripts,
 *     which covers all dynamically-imported Next.js route chunks.
 *   - In development `'unsafe-eval'` + `'unsafe-inline'` are added so HMR works.
 */

// ─── CSP Builder ──────────────────────────────────────────────────────────────

/**
 * Build the Content-Security-Policy string.
 * @param isDev  true in development — relaxes script-src for Next.js HMR
 * @param nonce  per-request nonce generated in middleware (production only)
 */
export function buildCSP(isDev: boolean, nonce?: string): string {
  // script-src:
  //   dev  → unsafe-eval + unsafe-inline  (HMR, React DevTools)
  //   prod → nonce + strict-dynamic       (Next.js hydration chunks)
  const scriptSrc = isDev
    ? ["'self'", "'unsafe-eval'", "'unsafe-inline'"]
    : [
        "'self'",
        nonce ? `'nonce-${nonce}'` : "'unsafe-inline'", // fallback if no nonce
        "'strict-dynamic'",
        // Vercel preview toolbar — only injected on *.vercel.app deployments
        "https://vercel.live",
        "https://*.vercel-scripts.com",
      ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,

    // Tailwind generates inline styles; CSS-in-JS libraries may too
    "style-src": ["'self'", "'unsafe-inline'"],

    // Allow images from anywhere over HTTPS (avatars, og-images, etc.)
    "img-src": ["'self'", "data:", "blob:", "https:"],

    "font-src": ["'self'", "data:"],

    // connect-src covers fetch(), XHR, SSE, WebSocket
    "connect-src": [
      "'self'", // SSE stream + own API routes
      "https://api.openai.com",
      "https://api.anthropic.com",
      "https://generativelanguage.googleapis.com",
      "https://*.upstash.io", // Upstash Redis REST
      "https://vercel.live", // Vercel live feedback
      "wss://vercel.live", // Vercel WebSocket
      "https://*.vercel-scripts.com",
      ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
    ],

    // No <frame>, <iframe>, <object> needed
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],

    "base-uri": ["'self'"],
    "form-action": ["'self'"],

    // Force HTTPS for any mixed-content resources
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([key, vals]) => (vals.length ? `${key} ${vals.join(" ")}` : key))
    .join("; ");
}

// ─── Full Header Map ──────────────────────────────────────────────────────────

export function getSecurityHeaders(isDev = false, nonce?: string): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",

    // HSTS — production only (Vercel handles HTTPS)
    ...(!isDev && {
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    }),

    "Content-Security-Policy": buildCSP(isDev, nonce),

    // Prevent cross-origin window access attacks
    "Cross-Origin-Opener-Policy": "same-origin",

    // Prevent cross-origin resource embedding
    "Cross-Origin-Resource-Policy": "same-origin",

    "Permissions-Policy": [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),

    // Strip server fingerprint
    "X-Powered-By": "",
  };
}

// ─── Apply to Response ────────────────────────────────────────────────────────

/**
 * Stamp all security headers onto a NextResponse.
 * Pass `nonce` from middleware so the CSP includes the per-request nonce.
 */
export function applySecurityHeaders(headers: Headers, isDev = false, nonce?: string): void {
  const map = getSecurityHeaders(isDev, nonce);
  for (const [key, value] of Object.entries(map)) {
    if (value) headers.set(key, value);
    else headers.delete(key);
  }
}
