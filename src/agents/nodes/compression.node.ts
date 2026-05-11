/**
 * Compression Agent Node
 *
 * Runs the compression pipeline on the original prompt.
 * Uses the mode recommended by the Token Analyzer (may be escalated).
 *
 * Retry logic:
 * - On first failure: retry with SAFE mode (less risky)
 * - On second failure: return original prompt unchanged
 * - Retry count is tracked in state for supervisor routing
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getCompressionService } from "@/services/compression/compression.service";
import { OptimizationMode } from "@/types/compression";
import { AgentName, WorkflowStatus } from "@/types/agent";
import {
  createStreamEvent,
  createTraceEntry,
  type WorkflowState,
} from "@/agents/state/workflow-state";

const log = createChildLogger({ module: "CompressionNode" });

export async function compressionNode(
  state: WorkflowState,
): Promise<Partial<WorkflowState>> {
  const startedAt = new Date();
  const compressionService = getCompressionService();

  // On retry, downgrade to SAFE mode to reduce risk
  const effectiveMode =
    state.retryCount > 0 ? OptimizationMode.SAFE : state.mode;

  log.info(
    { requestId: state.requestId, mode: effectiveMode, retry: state.retryCount },
    "Compression agent started",
  );

  const startEvent = createStreamEvent(
    "agent_start",
    `Compressing prompt (mode: ${effectiveMode}${state.retryCount > 0 ? `, retry #${state.retryCount}` : ""})`,
    { agent: AgentName.COMPRESSION },
  );

  try {
    const result = await compressionService.compress(
      state.originalPrompt,
      state.model,
      effectiveMode,
      {
        targetTokens: state.targetTokens,
        requestId: state.requestId,
      },
    );

    const trace = createTraceEntry(
      AgentName.COMPRESSION,
      startedAt,
      true,
      `${state.tokenAnalysis?.originalTokenCount ?? "?"} tokens, mode: ${effectiveMode}`,
      `${result.analysis.percentReduction.toFixed(1)}% reduction → ${result.analysis.compressedTokens} tokens`,
    );

    const event = createStreamEvent(
      "agent_complete",
      `Compression complete: ${result.analysis.percentReduction.toFixed(1)}% reduction (${result.analysis.originalTokens} → ${result.analysis.compressedTokens} tokens)`,
      {
        agent: AgentName.COMPRESSION,
        data: {
          originalTokens: result.analysis.originalTokens,
          compressedTokens: result.analysis.compressedTokens,
          percentReduction: result.analysis.percentReduction,
          mode: effectiveMode,
        },
      },
    );

    log.info(
      {
        requestId: state.requestId,
        percentReduction: result.analysis.percentReduction,
        compressedTokens: result.analysis.compressedTokens,
      },
      "Compression agent complete",
    );

    return {
      currentAgent: AgentName.COMPRESSION,
      compressionResult: result,
      detectedPromptType: result.promptType,
      agentTrace: [trace],
      streamEvents: [startEvent, event],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Compression failed";
    log.error({ requestId: state.requestId, err: error }, message);

    const trace = createTraceEntry(
      AgentName.COMPRESSION,
      startedAt,
      false,
      `mode: ${effectiveMode}`,
      "Failed",
      message,
    );

    return {
      currentAgent: AgentName.COMPRESSION,
      retryCount: state.retryCount + 1,
      errors: [{ agent: AgentName.COMPRESSION, message, timestamp: new Date().toISOString(), retryable: state.retryCount < state.maxRetries }],
      agentTrace: [trace],
      streamEvents: [
        startEvent,
        createStreamEvent("error", `Compression failed: ${message}`, { agent: AgentName.COMPRESSION }),
      ],
    };
  }
}
