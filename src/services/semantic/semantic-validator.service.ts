/**
 * Semantic Validator Service
 *
 * Core validation engine. Combines:
 * 1. Embedding similarity (objective, fast)
 * 2. Structural checks (deterministic rules)
 * 3. Confidence scoring (how reliable is our verdict)
 *
 * Composite score formula:
 *   meaningPreservationScore = (embeddingSimilarity * 0.7) + (structuralScore * 0.3)
 *
 * Why 70/30 split:
 * - Embeddings capture semantic meaning holistically
 * - Structural checks catch specific critical failures (missing code, URLs)
 * - Structural issues are binary — a missing URL is always critical
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getSimilarityService } from "@/services/semantic/similarity.service";
import type {
  SemanticIssue,
  SemanticValidationRequest,
  SemanticValidationResult,
} from "@/types/semantic";

const log = createChildLogger({ module: "SemanticValidatorService" });

// ─── Default Threshold ────────────────────────────────────────────────────────

// Below this cosine similarity → reject
const DEFAULT_THRESHOLD = 0.85;

export class SemanticValidatorService {
  private readonly similarity = getSimilarityService();

  /**
   * Validate that optimized prompt preserves original meaning.
   */
  async validate(request: SemanticValidationRequest): Promise<SemanticValidationResult> {
    const start = Date.now();
    const threshold = request.threshold ?? DEFAULT_THRESHOLD;

    log.debug({ requestId: request.requestId }, "Semantic validation started");

    // Run embedding similarity + structural checks in parallel
    const [similarityResult, structuralIssues] = await Promise.all([
      this.similarity.compare(request.original, request.optimized),
      Promise.resolve(this.runStructuralChecks(request.original, request.optimized)),
    ]);

    // Structural score: start at 1.0, deduct per issue
    const structuralScore = this.computeStructuralScore(structuralIssues);

    // Composite meaning preservation score
    const meaningPreservationScore = Number(
      (similarityResult.cosineSimilarity * 0.7 + structuralScore * 0.3).toFixed(4),
    );

    // Quality score 0-100 for UI
    const qualityScore = Math.round(meaningPreservationScore * 100);

    // Confidence: high when embedding similarity is strong, lower when borderline
    const confidence = this.computeConfidence(similarityResult.cosineSimilarity, threshold);

    // Validity and recommendation
    const hasCritical = structuralIssues.some((i) => i.severity === "critical");
    const isValid = !hasCritical && similarityResult.cosineSimilarity >= threshold;

    const recommendation = this.getRecommendation(
      isValid,
      similarityResult.cosineSimilarity,
      threshold,
      hasCritical,
    );

    const strengths = this.identifyStrengths(similarityResult, structuralIssues);

    const result: SemanticValidationResult = {
      requestId: request.requestId,
      embeddingSimilarity: similarityResult,
      meaningPreservationScore,
      qualityScore,
      confidence,
      isValid,
      recommendation,
      issues: structuralIssues,
      strengths,
      durationMs: Date.now() - start,
    };

    log.info(
      {
        requestId: request.requestId,
        score: meaningPreservationScore,
        similarity: similarityResult.cosineSimilarity,
        recommendation,
        durationMs: result.durationMs,
      },
      "Semantic validation complete",
    );

    return result;
  }

  // ─── Structural Checks ────────────────────────────────────────────────────

  private runStructuralChecks(original: string, optimized: string): SemanticIssue[] {
    const issues: SemanticIssue[] = [];

    // Critical: code blocks removed
    const origCode = original.match(/```[\s\S]*?```/g)?.length ?? 0;
    const optCode  = optimized.match(/```[\s\S]*?```/g)?.length ?? 0;
    if (origCode > optCode) {
      issues.push({ severity: "critical", message: `${origCode - optCode} code block(s) removed` });
    }

    // Critical: URLs removed
    const origUrls = original.match(/https?:\/\/\S+/g)?.length ?? 0;
    const optUrls  = optimized.match(/https?:\/\/\S+/g)?.length ?? 0;
    if (origUrls > optUrls) {
      issues.push({ severity: "critical", message: `${origUrls - optUrls} URL(s) removed` });
    }

    // Critical: negation flip ("do not" → "do")
    const origNeg = original.match(/\b(do not|don't|never|must not)\b/gi)?.length ?? 0;
    const optNeg  = optimized.match(/\b(do not|don't|never|must not)\b/gi)?.length ?? 0;
    if (origNeg > 0 && optNeg < origNeg) {
      issues.push({ severity: "critical", message: "Negation constraints may have been removed" });
    }

    // Warning: numbered steps reduced
    const origSteps = original.match(/^\s*\d+[.)]/gm)?.length ?? 0;
    const optSteps  = optimized.match(/^\s*\d+[.)]/gm)?.length ?? 0;
    if (origSteps > 0 && optSteps < origSteps) {
      issues.push({ severity: "warning", message: `Numbered steps reduced: ${origSteps} → ${optSteps}` });
    }

    // Warning: variables removed
    const origVars = original.match(/\{\{?\w+\}?\}/g)?.length ?? 0;
    const optVars  = optimized.match(/\{\{?\w+\}?\}/g)?.length ?? 0;
    if (origVars > optVars) {
      issues.push({ severity: "warning", message: `${origVars - optVars} template variable(s) removed` });
    }

    // Info: significant length reduction
    const lengthRatio = optimized.length / original.length;
    if (lengthRatio < 0.4) {
      issues.push({ severity: "info", message: `Large reduction: ${((1 - lengthRatio) * 100).toFixed(0)}% shorter` });
    }

    return issues;
  }

  private computeStructuralScore(issues: SemanticIssue[]): number {
    let score = 1.0;
    for (const issue of issues) {
      if (issue.severity === "critical") score -= 0.35;
      if (issue.severity === "warning")  score -= 0.10;
    }
    return Math.max(0, score);
  }

  private computeConfidence(cosine: number, threshold: number): number {
    // High confidence when far from threshold, low when borderline
    const distance = Math.abs(cosine - threshold);
    return Math.min(1, 0.5 + distance * 2);
  }

  private getRecommendation(
    isValid: boolean,
    cosine: number,
    threshold: number,
    hasCritical: boolean,
  ): SemanticValidationResult["recommendation"] {
    if (hasCritical) return "reject";
    if (!isValid && cosine >= threshold - 0.05) return "review"; // Borderline
    if (!isValid) return "reject";
    return "accept";
  }

  private identifyStrengths(
    similarity: ReturnType<typeof getSimilarityService>["compare"] extends Promise<infer T> ? T : never,
    issues: SemanticIssue[],
  ): string[] {
    const strengths: string[] = [];
    if (similarity.cosineSimilarity >= 0.95) strengths.push("Excellent semantic preservation");
    if (similarity.cosineSimilarity >= 0.90) strengths.push("Strong meaning retention");
    if (!issues.some((i) => i.severity === "critical")) strengths.push("No critical content removed");
    if (!issues.some((i) => i.severity === "warning")) strengths.push("No structural warnings");
    return strengths;
  }
}

let instance: SemanticValidatorService | null = null;
export function getSemanticValidator(): SemanticValidatorService {
  instance ??= new SemanticValidatorService();
  return instance;
}
