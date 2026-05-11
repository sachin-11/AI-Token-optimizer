/**
 * Prompt Injection Protection
 *
 * Detects and neutralizes prompt injection attacks before they reach the LLM.
 *
 * Attack patterns:
 * 1. Direct injection: "Ignore previous instructions and..."
 * 2. Role hijacking: "You are now DAN..."
 * 3. Delimiter injection: "---END SYSTEM---\nNew instructions:"
 * 4. Encoding attacks: Base64/hex encoded instructions
 * 5. Context overflow: Extremely long prompts designed to push system prompt out
 *
 * Strategy: detect → sanitize → flag (not block by default)
 * Blocking is too aggressive — false positives hurt UX.
 * Flag suspicious prompts for review, sanitize obvious attacks.
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "PromptInjection" });

// ─── Detection Patterns ───────────────────────────────────────────────────────

interface InjectionPattern {
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // Direct instruction override
  { pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/i, severity: "critical", type: "instruction-override" },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i, severity: "critical", type: "instruction-override" },
  { pattern: /forget\s+(everything|all)\s+(you|i)\s+(were|was|have been)\s+told/i, severity: "critical", type: "instruction-override" },
  { pattern: /new\s+instructions?:/i, severity: "high", type: "instruction-override" },
  { pattern: /override\s+(system|previous)\s+(prompt|instructions?)/i, severity: "critical", type: "instruction-override" },

  // Role hijacking
  { pattern: /you\s+are\s+now\s+(DAN|an?\s+AI\s+without|a\s+different)/i, severity: "critical", type: "role-hijack" },
  { pattern: /act\s+as\s+(if\s+you\s+are\s+)?(DAN|jailbreak|unrestricted)/i, severity: "critical", type: "role-hijack" },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(evil|unrestricted|unfiltered)/i, severity: "high", type: "role-hijack" },
  { pattern: /\[SYSTEM\]|\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>/i, severity: "high", type: "delimiter-injection" },

  // Delimiter injection
  { pattern: /---+\s*(END|STOP|IGNORE)\s*(SYSTEM|PROMPT|INSTRUCTIONS?)\s*---+/i, severity: "high", type: "delimiter-injection" },
  { pattern: /#{3,}\s*(SYSTEM|OVERRIDE|ADMIN)\s*#{3,}/i, severity: "high", type: "delimiter-injection" },

  // Data exfiltration attempts
  { pattern: /print\s+(your\s+)?(system\s+prompt|instructions?|configuration)/i, severity: "high", type: "exfiltration" },
  { pattern: /reveal\s+(your\s+)?(system\s+prompt|hidden\s+instructions?)/i, severity: "high", type: "exfiltration" },
  { pattern: /what\s+(are|were)\s+your\s+(original\s+)?(instructions?|system\s+prompt)/i, severity: "medium", type: "exfiltration" },

  // Jailbreak patterns
  { pattern: /do\s+anything\s+now/i, severity: "high", type: "jailbreak" },
  { pattern: /developer\s+mode\s+(enabled|on|activated)/i, severity: "high", type: "jailbreak" },
  { pattern: /jailbreak/i, severity: "medium", type: "jailbreak" },
];

// Suspicious but not necessarily malicious
const SUSPICIOUS_PATTERNS: RegExp[] = [
  /base64/i,
  /eval\s*\(/,
  /<script/i,
  /javascript:/i,
  /data:text\/html/i,
];

// ─── Injection Detector ───────────────────────────────────────────────────────

export interface InjectionScanResult {
  isSafe: boolean;
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  detectedPatterns: Array<{ type: string; severity: string; match: string }>;
  sanitizedContent: string;
  flags: string[];
}

export function scanForInjection(content: string): InjectionScanResult {
  const detectedPatterns: InjectionScanResult["detectedPatterns"] = [];
  const flags: string[] = [];
  let sanitized = content;

  // Check injection patterns
  for (const { pattern, severity, type } of INJECTION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      detectedPatterns.push({
        type,
        severity,
        match: match[0]!.slice(0, 50), // Truncate for logging
      });
    }
  }

  // Check suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(content)) {
      flags.push(`suspicious-pattern:${pattern.source.slice(0, 20)}`);
    }
  }

  // Check for unusually long repeated characters (padding attacks)
  if (/(.)\1{100,}/.test(content)) {
    flags.push("repeated-character-padding");
  }

  // Check for excessive special characters (encoding attacks)
  const specialCharRatio = (content.match(/[^\w\s.,!?;:'"()-]/g)?.length ?? 0) / content.length;
  if (specialCharRatio > 0.3 && content.length > 100) {
    flags.push("high-special-char-ratio");
  }

  // Determine risk level
  const hasCritical = detectedPatterns.some((p) => p.severity === "critical");
  const hasHigh     = detectedPatterns.some((p) => p.severity === "high");
  const hasMedium   = detectedPatterns.some((p) => p.severity === "medium");

  const riskLevel = hasCritical ? "critical"
    : hasHigh   ? "high"
    : hasMedium ? "medium"
    : flags.length > 0 ? "low"
    : "safe";

  // Sanitize: wrap suspicious content in a safety delimiter
  // We don't remove content (too aggressive) — we neutralize it
  if (riskLevel === "critical" || riskLevel === "high") {
    sanitized = sanitizeInjection(content);
    log.warn(
      { riskLevel, patterns: detectedPatterns.map((p) => p.type), flags },
      "Prompt injection detected",
    );
  }

  return {
    isSafe: riskLevel === "safe" || riskLevel === "low",
    riskLevel,
    detectedPatterns,
    sanitizedContent: sanitized,
    flags,
  };
}

/**
 * Sanitize injection attempts by escaping control sequences.
 * Preserves the text but neutralizes instruction-like patterns.
 */
function sanitizeInjection(content: string): string {
  return content
    // Neutralize instruction overrides
    .replace(/ignore\s+(all\s+)?(previous|prior|above)/gi, "[filtered]")
    .replace(/disregard\s+(all\s+)?(previous|prior)/gi, "[filtered]")
    .replace(/new\s+instructions?:/gi, "[filtered]:")
    // Neutralize role hijacking
    .replace(/you\s+are\s+now/gi, "you were")
    .replace(/act\s+as\s+(if\s+you\s+are\s+)?/gi, "consider ")
    // Neutralize delimiters
    .replace(/\[SYSTEM\]|\[INST\]|\[\/INST\]/gi, "[text]")
    .replace(/<\|system\|>|<\|user\|>/gi, "[text]");
}

/**
 * Quick check — returns true if content is safe to send to LLM.
 */
export function isPromptSafe(content: string): boolean {
  const result = scanForInjection(content);
  return result.isSafe;
}
