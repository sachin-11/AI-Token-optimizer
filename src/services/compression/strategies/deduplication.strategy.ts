/**
 * Deduplication Strategy — SAFE mode
 *
 * Removes exact duplicate sentences and paragraphs.
 * Safe because identical content carries zero additional information.
 *
 * Handles:
 * - Exact duplicate sentences
 * - Duplicate paragraphs
 * - Repeated instructions (common in agent prompts)
 */

import "server-only";

import { OptimizationMode, PromptType } from "@/types/compression";
import type { ICompressionStrategy, StrategyContext, StrategyResult } from "@/types/compression";

export class DeduplicationStrategy implements ICompressionStrategy {
  readonly name = "deduplication";
  readonly description = "Remove exact duplicate sentences and paragraphs";
  readonly minimumMode = OptimizationMode.SAFE;
  readonly applicableTypes: PromptType[] = []; // All types

  async apply(text: string, _context: StrategyContext): Promise<StrategyResult> {
    const transformations: string[] = [];
    let result = text;

    // ── Deduplicate paragraphs ──────────────────────────────────────────────
    const paragraphs = result.split(/\n\n+/);
    const seenParagraphs = new Set<string>();
    const uniqueParagraphs: string[] = [];
    let dupeParagraphCount = 0;

    for (const para of paragraphs) {
      const normalized = para.trim().toLowerCase();
      if (normalized && seenParagraphs.has(normalized)) {
        dupeParagraphCount++;
      } else {
        seenParagraphs.add(normalized);
        uniqueParagraphs.push(para);
      }
    }

    if (dupeParagraphCount > 0) {
      result = uniqueParagraphs.join("\n\n");
      transformations.push(`removed-${dupeParagraphCount}-duplicate-paragraphs`);
    }

    // ── Deduplicate sentences within paragraphs ─────────────────────────────
    const sentenceDeduped = result
      .split(/\n\n+/)
      .map((para) => this.deduplicateSentences(para))
      .join("\n\n");

    const sentencesRemoved =
      result.split(/[.!?]+/).length - sentenceDeduped.split(/[.!?]+/).length;

    if (sentencesRemoved > 0) {
      result = sentenceDeduped;
      transformations.push(`removed-${sentencesRemoved}-duplicate-sentences`);
    }

    return {
      text: result,
      transformationsApplied: transformations,
      tokensRemoved: 0,
    };
  }

  private deduplicateSentences(paragraph: string): string {
    // Split on sentence boundaries, preserving the delimiter
    const sentences = paragraph.match(/[^.!?]+[.!?]+/g) ?? [paragraph];
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const sentence of sentences) {
      const normalized = sentence.trim().toLowerCase().replace(/\s+/g, " ");
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(sentence);
      }
    }

    return unique.join("").trim();
  }
}
