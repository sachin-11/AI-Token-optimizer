/**
 * Bot Protection
 *
 * Heuristic-based bot detection without external services.
 * Runs at the Edge — no Redis needed for basic checks.
 *
 * Signals checked:
 * 1. User-Agent patterns (known bots, scrapers, scanners)
 * 2. Missing browser fingerprint headers
 * 3. Suspicious request patterns (no Referer on form POST)
 * 4. Honeypot header detection
 *
 * Why heuristics over CAPTCHA:
 * - Zero latency — runs in Edge middleware
 * - No UX friction for real users
 * - CAPTCHA can be added on top for high-risk endpoints
 */

// ─── Known Bad Patterns ───────────────────────────────────────────────────────

const BOT_UA_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i,
  /curl/i, /wget/i, /python-requests/i, /axios/i,
  /go-http-client/i, /java\//i, /libwww/i,
  /masscan/i, /nikto/i, /sqlmap/i, /nmap/i,
  /zgrab/i, /nuclei/i, /dirbuster/i,
];

// Legitimate bots we allow (search engines, monitoring)
const ALLOWED_BOT_PATTERNS = [
  /googlebot/i, /bingbot/i, /slurp/i,
  /duckduckbot/i, /uptimerobot/i, /pingdom/i,
];

// Headers that real browsers always send
const BROWSER_REQUIRED_HEADERS = ["accept", "accept-language"];

// ─── Bot Detection ────────────────────────────────────────────────────────────

export interface BotCheckResult {
  isBot: boolean;
  confidence: number;   // 0-1
  reason?: string;
}

export function detectBot(headers: Headers, method: string, pathname: string): BotCheckResult {
  const ua = headers.get("user-agent") ?? "";

  // No user-agent at all — very suspicious
  if (!ua) {
    return { isBot: true, confidence: 0.95, reason: "missing-user-agent" };
  }

  // Check allowed bots first
  if (ALLOWED_BOT_PATTERNS.some((p) => p.test(ua))) {
    return { isBot: false, confidence: 0.1 };
  }

  // Known bad UA patterns
  if (BOT_UA_PATTERNS.some((p) => p.test(ua))) {
    return { isBot: true, confidence: 0.9, reason: "bot-user-agent" };
  }

  // Missing browser headers on API POST — likely automated
  if (method === "POST" && pathname.startsWith("/api/")) {
    const missingHeaders = BROWSER_REQUIRED_HEADERS.filter((h) => !headers.get(h));
    if (missingHeaders.length === BROWSER_REQUIRED_HEADERS.length) {
      // Allow if has valid API key header (programmatic access is fine)
      if (headers.get("x-api-key") || headers.get("authorization")) {
        return { isBot: false, confidence: 0.2 };
      }
      return { isBot: true, confidence: 0.7, reason: "missing-browser-headers" };
    }
  }

  // Honeypot: if X-Bot-Trap header is present, it's a bot
  if (headers.get("x-bot-trap")) {
    return { isBot: true, confidence: 1.0, reason: "honeypot-triggered" };
  }

  return { isBot: false, confidence: 0.05 };
}

/**
 * Check if a request looks like a scanner/vulnerability probe.
 */
export function isSecurityScanner(pathname: string): boolean {
  const SCANNER_PATHS = [
    "/wp-admin", "/wp-login", "/.env", "/.git",
    "/admin.php", "/phpmyadmin", "/xmlrpc.php",
    "/actuator", "/.well-known/security.txt",
    "/config.json", "/api/swagger", "/graphql",
  ];
  return SCANNER_PATHS.some((p) => pathname.toLowerCase().startsWith(p));
}
