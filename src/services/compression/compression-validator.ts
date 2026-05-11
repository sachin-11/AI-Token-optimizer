/**
 * Compression Validator
 *
 * Validates that compression didn't break the prompt.
 * Checks for:
 * - Critical content removal (code, URLs, numbers)
 * - Excessive compression (>70% reduction is suspicious)
 * - Unrestored placeholders (indicates pipeline bug)
 * - Meaning drift (heuristic checks)
 *
 * Why validation matters:
 * - Aggressive compression can hallucinate or drop critical details
 * - Better to use the original than a broken compressed version
 * - Validation gives us confidence to use AGGRESSIVE mode in production
 */

import "server-only";

import { getRegionProtector } from "@/services/compression/region-protector";
import { ValidationIssueCode, type ValidationIssue, type ValidationResult } from "@/types/compression";

export class CompressionValidator {
  private readonly protector = getRegionProtector();

  /**
   * Validate compressed output against original.
   */
  validate(original: string, compressed: string, compressionRatio: number): ValidationResult {
    const issues: ValidationIssue[] = [];

    // ── Check for unrestored placeholders ───────────────────────────────────
    if (this.protector.hasUnrestoredPlaceholders(compressed)) {
      issues.push({
        severity: "error",
        code: ValidationIssueCode.CRITICAL_CONTENT_REMOVED,
        message: "Protected regions were not restored — pipeline bug",
      });
    }

    // ── Check for excessive compression ─────────────────────────────────────
    if (compressionRatio < 0.3) {
      issues.push({
        severity: "warning",
        code: ValidationIssueCode.EXCESSIVE_COMPRESSION,
        message: `Compression ratio ${compressionRatio.toFixed(2)} is suspiciously low — possible content loss`,
      });
    }

    // ── Check for critical pattern removal ─────────────────────────────────
    this.checkCriticalPatterns(original, compressed, issues);

    // ── Check for instruction loss ──────────────────────────────────────────
    this.checkInstructionLoss(original, compressed, issues);

    // ── Calculate meaning preservation score ────────────────────────────────
    const meaningScore = this.estimateMeaningPreservation(original, compressed, issues);

    // ── Determine recommendation ────────────────────────────────────────────
    const hasErrors = issues.some((i) => i.severity === "error");
    const hasWarnings = issues.some((i) => i.severity === "warning");

    let recommendation: ValidationResult["recommendation"];
    if (hasErrors) {
      recommendation = "use_original";
    } else if (hasWarnings || meaningScore < 0.8) {
      recommendation = "use_with_caution";
    } else {
      recommendation = "use_compressed";
    }

    return {
      isValid: !hasErrors,
      meaningPreservationScore: meaningScore,
      issues,
      recommendation,
    };
  }

  // ─── Private Checks ───────────────────────────────────────────────────────

  private checkCriticalPatterns(
    original: string,
    compressed: string,
    issues: ValidationIssue[],
  ): void {
    // URLs
    const originalUrls = original.match(/https?:\/\/[^\s)>\]"]+/g) ?? [];
    const compressedUrls = compressed.match(/https?:\/\/[^\s)>\]"]+/g) ?? [];
    if (originalUrls.length > compressedUrls.length) {
      issues.push({
        severity: "error",
        code: ValidationIssueCode.URL_REMOVED,
        message: `${originalUrls.length - compressedUrls.length} URL(s) were removed`,
      });
    }

    // Code blocks
    const originalCodeBlocks = original.match(/```[\s\S]*?```/g) ?? [];
    const compressedCodeBlocks = compressed.match(/```[\s\S]*?```/g) ?? [];
    if (originalCodeBlocks.length > compressedCodeBlocks.length) {
      issues.push({
        severity: "error",
        code: ValidationIssueCode.CODE_BLOCK_MODIFIED,
        message: `${originalCodeBlocks.length - compressedCodeBlocks.length} code block(s) were removed`,
      });
    }

    // Variables
    const originalVars = original.match(/\{\{?\s*\w+\s*\}?\}/g) ?? [];
    const compressedVars = compressed.match(/\{\{?\s*\w+\s*\}?\}/g) ?? [];
    if (originalVars.length > compressedVars.length) {
      issues.push({
        severity: "warning",
        code: ValidationIssueCode.VARIABLE_REMOVED,
        message: `${originalVars.length - compressedVars.length} variable(s) may have been removed`,
      });
    }

    // Numbers with units (likely important metrics)
    const originalNumbers = original.match(/\b\d+(?:\.\d+)?\s*(?:ms|s|kb|mb|gb|tokens?)\b/gi) ?? [];
    const compressedNumbers = compressed.match(/\b\d+(?:\.\d+)?\s*(?:ms|s|kb|mb|gb|tokens?)\b/gi) ?? [];
    if (originalNumbers.length > compressedNumbers.length) {
      issues.push({
        severity: "warning",
        code: ValidationIssueCode.NUMBER_CHANGED,
        message: "Numeric values with units may have been modified",
      });
    }
  }

  private checkInstructionLoss(
    original: string,
    compressed: string,
    issues: ValidationIssue[],
  ): void {
    // Check for imperative verbs (instructions)
    const imperatives = /\b(must|should|need to|have to|ensure|verify|check|validate|do not|don't|never|always)\b/gi;
    const originalImperatives = original.match(imperatives) ?? [];
    const compressedImperatives = compressed.match(imperatives) ?? [];

    if (compressedImperatives.length < originalImperatives.length * 0.7) {
      issues.push({
        severity: "warning",
        code: ValidationIssueCode.INSTRUCTION_LOST,
        message: "Significant reduction in imperative instructions detected",
      });
    }

    // Check for numbered lists (often critical steps)
    const originalNumberedItems = original.match(/^\s*\d+[.)]\s+/gm) ?? [];
    const compressedNumberedItems = compressed.match(/^\s*\d+[.)]\s+/gm) ?? [];

    if (originalNumberedItems.length > 0 && compressedNumberedItems.length < originalNumberedItems.length) {
      issues.push({
        severity: "error",
        code: ValidationIssueCode.INSTRUCTION_LOST,
        message: `${originalNumberedItems.length - compressedNumberedItems.length} numbered instruction(s) were removed`,
      });
    }
  }

  private estimateMeaningPreservation(
    original: string,
    compressed: string,
    issues: ValidationIssue[],
  ): number {
    // Start at 1.0 (perfect preservation)
    let score = 1.0;

    // Penalize based on issues
    for (const issue of issues) {
      if (issue.severity === "error") score -= 0.3;
      if (issue.severity === "warning") score -= 0.1;
    }

    // Penalize if key terms are missing
    const originalWords = new Set(original.toLowerCase().match(/\b\w{4,}\b/g) ?? []);
    const compressedWords = new Set(compressed.toLowerCase().match(/\b\w{4,}\b/g) ?? []);

    const keyWordsPreserved = [...originalWords].filter((w) => compressedWords.has(w)).length;
    const keyWordRatio = originalWords.size > 0 ? keyWordsPreserved / originalWords.size : 1;

    // Weight key word preservation heavily
    score *= 0.3 + 0.7 * keyWordRatio;

    return Math.max(0, Math.min(1, score));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: CompressionValidator | null = null;
export function getCompressionValidator(): CompressionValidator {
  instance ??= new CompressionValidator();
  return instance;
}
