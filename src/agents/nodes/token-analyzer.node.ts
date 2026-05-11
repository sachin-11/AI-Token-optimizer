/**
 * Token Analyzer Agent Node
 *
 * First agent in the pipeline. Analyzes the original prompt to:
 * - Count exact tokens
 * - Check context window utilization
 * - Estimate cost
 * - Recommend compression mode
 * - Determine compression urgency
 *
 * Why first:
 * - Supervisor needs this data to make routing decisions
 * - If prompt is tiny (<100 tokens), skip compression entirely
 * - If prompt is critical overflow, escalate to AGGRESSIVE mode
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getTokenCounter } from "@/services/token/token-counter.service";
import { getContextAnalyzer } from "@/services/token/context-analyzer.service";
import { getCostEstimator } from "@/services/token/cost-estimator.service";
import { OptimizationMode } from "@/types/compression";
import {
  AgentName,
  WorkflowStatus,
  type TokenAnalysisOutput,
} from "@/types/agent";
import {
  createStreamEvent,
  createTraceEntry,
  type WorkflowState,
} from "@/agents/state/workflow-state";

const log = createChildLogger({ module: "TokenAnalyzerNode" });

// ─── Urgency Thresholds ───────────────────────────────────────────────────────

function getCompressionUrgency(
  utilizationPercent: number,
  fitsInContext: boolean,
): TokenAnalysisOutput["compressionUrgency"] {
  if (!fitsInContext) return "critical";
  if (utilizationPercent >= 85) return "high";
  if (utilizationPercent >= 70) return "medium";
  if (utilizationPercent >= 50) return "low";
  return "none";
}

function recommendMode(
  tokenCount: number,
  urgency: TokenAnalysisOutput["compressionUrgency"],
  requestedMode: OptimizationMode,
): OptimizationMode {
  // Critical overflow — force aggressive regardless of requested mode
  if (urgency === "critical") return OptimizationMode.AGGRESSIVE;
  // High utilization — escalate one level
  if (urgency === "high" && requestedMode === OptimizationMode.SAFE) {
    return OptimizationMode.BALANCED;
  }
  // Very short prompt — downgrade to safe (no point being aggressive)
  if (tokenCount < 100) return OptimizationMode.SAFE;
  return requestedMode;
}

// ─── Node Function ────────────────────────────────────────────────────────────

export async function tokenAnalyzerNode(
  state: WorkflowState,
): Promise<Partial<WorkflowState>> {
  const startedAt = new Date();
  log.info({ requestId: state.requestId }, "Token analyzer started");

  const tokenCounter = getTokenCounter();
  const contextAnalyzer = getContextAnalyzer();
  const costEstimator = getCostEstimator();

  try {
    // Run all analyses in parallel
    const [tokenCount, contextAnalysis, costEstimate] = await Promise.all([
      tokenCounter.countText(state.originalPrompt, state.model),
      contextAnalyzer.analyzeText(state.originalPrompt, state.model),
      costEstimator.estimateCompletionCost(
        [{ role: "user", content: state.originalPrompt }],
        state.model,
        { taskType: "promptOptimization" },
      ),
    ]);

    const urgency = getCompressionUrgency(
      contextAnalysis.utilizationPercent,
      contextAnalysis.fitsInContext,
    );

    const recommendedMode = recommendMode(
      tokenCount.tokenCount,
      urgency,
      state.mode,
    );

    const output: TokenAnalysisOutput = {
      originalTokenCount: tokenCount.tokenCount,
      contextWindowAnalysis: contextAnalysis,
      estimatedCostUsd: costEstimate.cost.totalCostUsd,
      recommendedMode,
      compressionNeeded: urgency !== "none" || tokenCount.tokenCount > 200,
      compressionUrgency: urgency,
    };

    const trace = createTraceEntry(
      AgentName.TOKEN_ANALYZER,
      startedAt,
      true,
      `Analyzing ${tokenCount.tokenCount} tokens for model ${state.model}`,
      `Urgency: ${urgency}, recommended mode: ${recommendedMode}`,
    );

    const event = createStreamEvent(
      "agent_complete",
      `Token analysis complete: ${tokenCount.tokenCount} tokens, urgency: ${urgency}`,
      { agent: AgentName.TOKEN_ANALYZER, data: { tokenCount: tokenCount.tokenCount, urgency } },
    );

    log.info(
      { requestId: state.requestId, tokenCount: tokenCount.tokenCount, urgency },
      "Token analyzer complete",
    );

    return {
      currentAgent: AgentName.TOKEN_ANALYZER,
      tokenAnalysis: output,
      // Escalate mode if needed
      mode: recommendedMode,
      agentTrace: [trace],
      streamEvents: [event],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token analysis failed";
    log.error({ requestId: state.requestId, err: error }, message);

    const trace = createTraceEntry(
      AgentName.TOKEN_ANALYZER,
      startedAt,
      false,
      state.originalPrompt.slice(0, 100),
      "Failed",
      message,
    );

    return {
      currentAgent: AgentName.TOKEN_ANALYZER,
      status: WorkflowStatus.FAILED,
      errors: [{ agent: AgentName.TOKEN_ANALYZER, message, timestamp: new Date().toISOString(), retryable: true }],
      agentTrace: [trace],
      streamEvents: [createStreamEvent("error", message, { agent: AgentName.TOKEN_ANALYZER })],
    };
  }
}
