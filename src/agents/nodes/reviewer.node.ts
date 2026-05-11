/**
 * Reviewer Agent Node
 *
 * Final quality gate before the workflow completes.
 * Produces a holistic quality score combining:
 * - Token efficiency (how much was saved)
 * - Semantic preservation (from validator)
 * - Structural integrity (from compression validator)
 * - Overall recommendation
 *
 * Why a separate reviewer:
 * - Validator checks semantic safety (binary: safe/unsafe)
 * - Reviewer checks overall quality (continuous: 0-100 score)
 * - Reviewer can override validator in edge cases
 * - Provides human-readable review notes for the UI
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { AgentName, type ReviewOutput } from "@/types/agent";
import {
  createStreamEvent,
  createTraceEntry,
  type WorkflowState,
} from "@/agents/state/workflow-state";

const log = createChildLogger({ module: "ReviewerNode" });

// ─── Scoring Weights ──────────────────────────────────────────────────────────

const WEIGHTS = {
  tokenEfficiency: 0.35,
  semanticPreservation: 0.40,
  structuralIntegrity: 0.25,
} as const;

export async function reviewerNode(
  state: WorkflowState,
): Promise<Partial<WorkflowState>> {
  const startedAt = new Date();

  log.info({ requestId: state.requestId }, "Reviewer agent started");

  const startEvent = createStreamEvent(
    "agent_start",
    "Reviewing optimization quality",
    { agent: AgentName.REVIEWER },
  );

  try {
    const compression = state.compressionResult;
    const validation = state.validationOutput;

    if (!compression) {
      throw new Error("No compression result available for review");
    }

    // ── Token Efficiency Score (0-100) ──────────────────────────────────────
    // 0% reduction = 0 score, 50%+ reduction = 100 score
    const tokenEfficiencyScore = Math.min(
      100,
      Math.round((compression.analysis.percentReduction / 50) * 100),
    );

    // ── Semantic Preservation Score (0-100) ─────────────────────────────────
    const semanticScore = validation
      ? Math.round(validation.meaningPreservationScore * 100)
      : Math.round(compression.validation.meaningPreservationScore * 100);

    // ── Structural Integrity Score (0-100) ──────────────────────────────────
    const structuralScore = compression.validation.isValid
      ? 100 - compression.validation.issues.filter((i) => i.severity === "error").length * 30
      : 40;

    // ── Composite Quality Score ─────────────────────────────────────────────
    const qualityScore = Math.round(
      tokenEfficiencyScore * WEIGHTS.tokenEfficiency +
      semanticScore * WEIGHTS.semanticPreservation +
      Math.max(0, structuralScore) * WEIGHTS.structuralIntegrity,
    );

    // ── Final Decision ──────────────────────────────────────────────────────
    const finalDecision = determineFinalDecision(
      qualityScore,
      validation,
      compression.validation.recommendation,
    );

    // ── Review Notes ────────────────────────────────────────────────────────
    const suggestions = buildSuggestions(
      compression.analysis.percentReduction,
      semanticScore,
      structuralScore,
      validation?.semanticIssues ?? [],
    );

    const reviewNotes = buildReviewNotes(
      qualityScore,
      tokenEfficiencyScore,
      semanticScore,
      compression.analysis,
    );

    const output: ReviewOutput = {
      approved: finalDecision !== "retry",
      qualityScore,
      tokenEfficiencyScore,
      suggestions,
      finalDecision,
      reviewNotes,
    };

    const trace = createTraceEntry(
      AgentName.REVIEWER,
      startedAt,
      true,
      `Reviewing: ${compression.analysis.percentReduction.toFixed(1)}% reduction`,
      `Quality: ${qualityScore}/100, decision: ${finalDecision}`,
    );

    const event = createStreamEvent(
      "agent_complete",
      `Review complete: quality score ${qualityScore}/100 — ${finalDecision}`,
      {
        agent: AgentName.REVIEWER,
        data: { qualityScore, tokenEfficiencyScore, semanticScore, finalDecision },
      },
    );

    log.info(
      { requestId: state.requestId, qualityScore, finalDecision },
      "Reviewer agent complete",
    );

    return {
      currentAgent: AgentName.REVIEWER,
      reviewOutput: output,
      agentTrace: [trace],
      streamEvents: [startEvent, event],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed";
    log.error({ requestId: state.requestId, err: error }, message);

    const trace = createTraceEntry(
      AgentName.REVIEWER,
      startedAt,
      false,
      "Review attempt",
      "Failed",
      message,
    );

    return {
      currentAgent: AgentName.REVIEWER,
      errors: [{ agent: AgentName.REVIEWER, message, timestamp: new Date().toISOString(), retryable: false }],
      agentTrace: [trace],
      streamEvents: [
        startEvent,
        createStreamEvent("error", message, { agent: AgentName.REVIEWER }),
      ],
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function determineFinalDecision(
  qualityScore: number,
  validation: WorkflowState["validationOutput"],
  structuralRecommendation: string,
): ReviewOutput["finalDecision"] {
  // Hard reject: structural errors
  if (structuralRecommendation === "use_original") return "use_original";

  // Semantic validator says reject
  if (validation?.recommendation === "reject") return "use_original";

  // Retry if semantic validator suggests it and we haven't exceeded retries
  if (validation?.recommendation === "retry_with_safe_mode") return "retry";

  // Quality too low
  if (qualityScore < 40) return "use_original";

  return "use_compressed";
}

function buildSuggestions(
  percentReduction: number,
  semanticScore: number,
  structuralScore: number,
  semanticIssues: string[],
): string[] {
  const suggestions: string[] = [];

  if (percentReduction < 10) {
    suggestions.push("Consider using AGGRESSIVE mode for greater token savings");
  }
  if (semanticScore < 80) {
    suggestions.push("Semantic preservation is below threshold — review compressed output manually");
  }
  if (structuralScore < 70) {
    suggestions.push("Structural issues detected — check for missing code blocks or URLs");
  }
  suggestions.push(...semanticIssues.slice(0, 2));

  return suggestions;
}

function buildReviewNotes(
  qualityScore: number,
  tokenEfficiencyScore: number,
  semanticScore: number,
  analysis: WorkflowState["compressionResult"]["analysis"],
): string {
  const grade =
    qualityScore >= 80 ? "Excellent" :
    qualityScore >= 60 ? "Good" :
    qualityScore >= 40 ? "Acceptable" : "Poor";

  return `${grade} optimization (${qualityScore}/100). ` +
    `Reduced ${analysis.percentReduction.toFixed(1)}% tokens ` +
    `(${analysis.originalTokens} → ${analysis.compressedTokens}). ` +
    `Token efficiency: ${tokenEfficiencyScore}/100, ` +
    `Semantic preservation: ${semanticScore}/100. ` +
    `Estimated savings: $${analysis.costSavingsUsd.toFixed(6)}.`;
}
