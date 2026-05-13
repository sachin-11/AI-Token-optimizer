/**
 * Redundancy Removal Strategy — BALANCED mode
 *
 * Removes semantically redundant content:
 * - Preamble sentences that restate the obvious
 * - Closing pleasantries
 * - Repeated context that was already established
 * - Tautological phrases
 *
 * More aggressive than whitespace/dedup but still deterministic.
 */

import "server-only";

import { OptimizationMode, PromptType } from "@/types/compression";
import type { ICompressionStrategy, StrategyContext, StrategyResult } from "@/types/compression";

// ─── Redundant Patterns ───────────────────────────────────────────────────────

// Opening preambles that add no information
const REDUNDANT_PREAMBLES = [
  /^(Hello|Hi|Hey)[,!]?\s*/i,
  /^(Sure|Certainly|Of course|Absolutely)[,!]?\s*/i,
  /^(As an AI( language model)?|As a helpful assistant)[,.]?\s*/i,
  /^I('ll| will) (help|assist) you (with|to)\s*/i,
  /^(Let me|I'll) (explain|describe|outline|walk you through)\s*/i,
  /^(Here is|Here's|Below is|The following is) (a|an|the) (detailed |comprehensive |complete )?(explanation|description|overview|summary|list|guide) of\s*/i,
  /^(This|The following) (prompt|text|content|message) (is about|describes|explains|covers)\s*/i,
];

// Closing pleasantries
const REDUNDANT_CLOSINGS = [
  /\s*(Let me know if you (need|have) (any )?(more|further|additional) (help|assistance|questions|clarification)[.!]?)\s*$/i,
  /\s*(Feel free to ask if you (need|have) (any )?(more|further|additional) (help|questions)[.!]?)\s*$/i,
  /\s*(I hope (this|that) (helps|is helpful|answers your question)[.!]?)\s*$/i,
  /\s*(Please (let me know|feel free to ask) if you (need|have) (any )?(questions|clarification)[.!]?)\s*$/i,
  /\s*(Is there anything else (I can help you with|you'd like to know)[?!]?)\s*$/i,
];

// Tautological phrases
const TAUTOLOGIES = [
  { pattern: /\b(each and every)\b/gi, replacement: "every" },
  { pattern: /\b(first and foremost)\b/gi, replacement: "first" },
  { pattern: /\b(null and void)\b/gi, replacement: "void" },
  { pattern: /\b(true and accurate)\b/gi, replacement: "accurate" },
  { pattern: /\b(various different)\b/gi, replacement: "various" },
  { pattern: /\b(end result)\b/gi, replacement: "result" },
  { pattern: /\b(final outcome)\b/gi, replacement: "outcome" },
  { pattern: /\b(past history|past experience)\b/gi, replacement: (m: string) => m.split(" ")[1] ?? m },
  { pattern: /\b(future plans)\b/gi, replacement: "plans" },
  { pattern: /\b(advance planning)\b/gi, replacement: "planning" },
  { pattern: /\b(completely finished|completely done)\b/gi, replacement: "finished" },
  { pattern: /\b(repeat again|revert back|return back)\b/gi, replacement: (m: string) => m.split(" ")[0] ?? m },
];

export class RedundancyStrategy implements ICompressionStrategy {
  readonly name = "redundancy-removal";
  readonly description = "Remove preambles, closings, and tautological phrases";
  readonly minimumMode = OptimizationMode.SAFE;
  readonly applicableTypes: PromptType[] = [
    PromptType.GENERAL,
    PromptType.AGENT,
    PromptType.SYSTEM,
    PromptType.INSTRUCTION,
    PromptType.CONVERSATIONAL,
    PromptType.TECHNICAL,
    PromptType.CODING,
  ];

  async apply(text: string, _context: StrategyContext): Promise<StrategyResult> {
    const transformations: string[] = [];
    let result = text;

    // Remove redundant preambles
    for (const pattern of REDUNDANT_PREAMBLES) {
      const before = result;
      result = result.replace(pattern, "");
      if (result !== before) {
        transformations.push("removed-preamble");
        result = result.charAt(0).toUpperCase() + result.slice(1);
      }
    }

    // Remove redundant closings
    for (const pattern of REDUNDANT_CLOSINGS) {
      const before = result;
      result = result.replace(pattern, "");
      if (result !== before) {
        transformations.push("removed-closing-pleasantry");
      }
    }

    // Fix tautologies
    for (const { pattern, replacement } of TAUTOLOGIES) {
      const before = result;
      if (typeof replacement === "string") {
        result = result.replace(pattern, replacement);
      } else {
        result = result.replace(pattern, replacement);
      }
      if (result !== before) {
        transformations.push(`fixed-tautology`);
      }
    }

    return {
      text: result.trim(),
      transformationsApplied: transformations,
      tokensRemoved: 0,
    };
  }
}
