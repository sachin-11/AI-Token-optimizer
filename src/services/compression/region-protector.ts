/**
 * Region Protector
 *
 * Before compression, extracts protected regions (code, URLs, variables)
 * and replaces them with stable placeholders.
 * After compression, restores the originals.
 *
 * Why this approach:
 * - Compression strategies work on plain text
 * - Without protection, regex-based strategies would mangle code syntax
 * - Placeholder approach is simpler and safer than teaching every strategy
 *   about every protected pattern
 *
 * Example:
 *   Input:  "Call `getUserById(id)` to fetch the user"
 *   After protect:  "Call __CODE_0__ to fetch the user"
 *   After compress: "Call __CODE_0__ to get user"
 *   After restore:  "Call `getUserById(id)` to get user"
 */

import "server-only";

import type { ProtectedRegion } from "@/types/compression";

// ─── Placeholder Format ───────────────────────────────────────────────────────

// Unique prefix that won't appear in normal text
const PLACEHOLDER_PREFIX = "__PROT_";
const PLACEHOLDER_SUFFIX = "__";

function makePlaceholder(type: ProtectedRegion["type"], index: number): string {
  return `${PLACEHOLDER_PREFIX}${type.toUpperCase()}_${index}${PLACEHOLDER_SUFFIX}`;
}

// ─── Extraction Patterns (order matters — more specific first) ────────────────

const EXTRACTION_PATTERNS: Array<{
  pattern: RegExp;
  type: ProtectedRegion["type"];
}> = [
  // Fenced code blocks (highest priority)
  { pattern: /```[\s\S]*?```/g, type: "code" },
  // Inline code
  { pattern: /`[^`\n]+`/g, type: "code" },
  // URLs
  { pattern: /https?:\/\/[^\s)>\]"',]+/g, type: "url" },
  // Template variables {{var}} or {var}
  { pattern: /\{\{?\s*[\w.]+\s*\}?\}/g, type: "variable" },
  // JS template literals ${expr}
  { pattern: /\$\{[^}]+\}/g, type: "variable" },
  // Standalone numbers with units (preserve exact values)
  { pattern: /\b\d+(?:\.\d+)?(?:\s*(?:ms|s|kb|mb|gb|px|em|rem|%|tokens?|chars?))\b/gi, type: "number" },
];

// ─── Region Protector ─────────────────────────────────────────────────────────

export class RegionProtector {
  /**
   * Extract protected regions and replace with placeholders.
   * Returns the modified text and the region map for later restoration.
   */
  protect(
    text: string,
    additionalPatterns: RegExp[] = [],
  ): { text: string; regions: ProtectedRegion[] } {
    const regions: ProtectedRegion[] = [];
    let protected_ = text;
    let index = 0;

    const allPatterns = [
      ...EXTRACTION_PATTERNS,
      ...additionalPatterns.map((pattern) => ({ pattern, type: "custom" as const })),
    ];

    for (const { pattern, type } of allPatterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;

      protected_ = protected_.replace(pattern, (match) => {
        // Don't double-protect already-protected regions
        if (match.startsWith(PLACEHOLDER_PREFIX)) return match;

        const placeholder = makePlaceholder(type, index++);
        regions.push({ placeholder, original: match, type });
        return placeholder;
      });
    }

    return { text: protected_, regions };
  }

  /**
   * Restore protected regions from placeholders.
   */
  restore(text: string, regions: ProtectedRegion[]): string {
    let restored = text;

    // Restore in reverse order to handle nested placeholders correctly
    for (const region of [...regions].reverse()) {
      restored = restored.replace(region.placeholder, region.original);
    }

    return restored;
  }

  /**
   * Check if a text contains any placeholders (useful for validation).
   */
  hasUnrestoredPlaceholders(text: string): boolean {
    return text.includes(PLACEHOLDER_PREFIX);
  }

  /**
   * Extract all placeholder names from text.
   */
  findPlaceholders(text: string): string[] {
    const matches = text.match(/__PROT_[A-Z]+_\d+__/g);
    return matches ?? [];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: RegionProtector | null = null;
export function getRegionProtector(): RegionProtector {
  instance ??= new RegionProtector();
  return instance;
}
