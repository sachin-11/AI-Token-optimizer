/**
 * Security Headers — applied in Edge Middleware on every response.
 *
 * script-src strategy:
 *   Next.js generates inline hydration scripts, chunk-loader scripts, and
 *   __NEXT_DATA__ blocks that cannot carry a nonce without deep layout changes.
 *   'unsafe-inline' is therefore required.  All other directives remain strict.
 */

export function buildCSP(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // 'unsafe-inline'  — Next.js hydration + __NEXT_DATA__ inline scripts
    // 'unsafe-eval'    — only in dev (React DevTools, HMR eval)
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      "https://vercel.live",
      "https://*.vercel-scripts.com",
    ],

    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],

    "connect-src": [
      "'self'",
      "https://api.openai.com",
      "https://api.anthropic.com",
      "https://generativelanguage.googleapis.com",
      "https://*.upstash.io",
      "https://vercel.live",
      "wss://vercel.live",
      "https://*.vercel-scripts.com",
      ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
    ],

    "frame-src": ["https://vercel.live", "https://*.vercel-scripts.com"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

export function getSecurityHeaders(isDev = false): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": buildCSP(isDev),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
    ...(!isDev && {
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    }),
    "X-Powered-By": "",
  };
}

export function applySecurityHeaders(headers: Headers, isDev = false): void {
  for (const [k, v] of Object.entries(getSecurityHeaders(isDev))) {
    if (v) headers.set(k, v);
    else headers.delete(k);
  }
}
