/**
 * Workflow Orchestrator
 *
 * Public API for running the optimization workflow.
 * Wraps the LangGraph execution with:
 * - Input validation
 * - State initialization
 * - Streaming support (SSE-compatible)
 * - Result extraction
 * - Error handling
 */

import "server-only";

import { nanoid } from "nanoid";

import { createChildLogger } from "@/lib/logger";
import { getOptimizationGraph } from "@/agents/graph/optimization.graph";
import {
  buildInitialState,
  type WorkflowState,
} from "@/agents/state/workflow-state";
import {
  WorkflowStatus,
  type WorkflowRequest,
  type WorkflowResult,
  type StreamEvent,
} from "@/types/agent";

const log = createChildLogger({ module: "WorkflowOrchestrator" });

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class WorkflowOrchestrator {
  /**
   * Run the full optimization workflow and return the final result.
   * Use this for non-streaming API endpoints.
   */
  async run(request: WorkflowRequest): Promise<WorkflowResult> {
    const requestId = request.requestId ?? nanoid();
    const startTime = Date.now();

    log.info({ requestId, model: request.model, mode: request.mode }, "Workflow started");

    const graph = getOptimizationGraph();

    const initialState = buildInitialState({
      requestId,
      originalPrompt: request.prompt,
      model: request.model,
      mode: request.mode,
      userId: request.userId,
      targetTokens: request.targetTokens,
      maxRetries: request.maxRetries ?? 2,
    });

    try {
      // Execute the full graph — returns final state
      const finalState = await graph.invoke(initialState);

      const durationMs = Date.now() - startTime;

      log.info(
        {
          requestId,
          status: finalState.status,
          durationMs,
          tokensSaved: finalState.compressionResult?.analysis.tokensSaved ?? 0,
        },
        "Workflow completed",
      );

      return this.buildResult(finalState, durationMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow failed";
      log.error({ requestId, err: error }, message);

      return {
        requestId,
        status: WorkflowStatus.FAILED,
        originalPrompt: request.prompt,
        finalPrompt: request.prompt, // Fallback to original
        tokensSaved: 0,
        compressionRatio: 1.0,
        costSavingsUsd: 0,
        qualityScore: 0,
        agentTrace: [],
        streamEvents: [],
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Run the workflow with streaming — yields StreamEvents as they happen.
   * Use this for SSE endpoints to show real-time progress in the UI.
   *
   * @example
   * const stream = orchestrator.stream(request);
   * for await (const event of stream) {
   *   res.write(`data: ${JSON.stringify(event)}\n\n`);
   * }
   */
  async *stream(request: WorkflowRequest): AsyncGenerator<StreamEvent> {
    const requestId = request.requestId ?? nanoid();
    const graph = getOptimizationGraph();
    const streamStartedAt = Date.now();

    const initialState = buildInitialState({
      requestId,
      originalPrompt: request.prompt,
      model: request.model,
      mode: request.mode,
      userId: request.userId,
      targetTokens: request.targetTokens,
      maxRetries: request.maxRetries ?? 2,
    });

    yield {
      type: "progress",
      message: "Workflow started",
      timestamp: new Date().toISOString(),
      data: { requestId },
    };

    try {
      // Stream both partial updates (for per-node streamEvents) and full state snapshots
      // after each step. We must not call invoke/run again after streaming — that was a
      // second full workflow and could return a different (often zero-savings) result.
      let lastValueState: WorkflowState | null = null;

      for await (const chunk of await graph.stream(initialState, {
        streamMode: ["updates", "values"],
      })) {
        if (Array.isArray(chunk) && chunk.length === 2 && typeof chunk[0] === "string") {
          const [mode, payload] = chunk;

          if (mode === "values") {
            lastValueState = payload as WorkflowState;
            continue;
          }

          if (mode === "updates" && payload && typeof payload === "object") {
            const updates = Object.values(payload) as Array<{ streamEvents?: StreamEvent[] }>;
            for (const update of updates) {
              const newEvents = update.streamEvents ?? [];
              for (const event of newEvents) {
                yield event;
              }
            }
          }
          continue;
        }

        // Single-mode streams yield the payload directly (unexpected with array streamMode)
        if (chunk && typeof chunk === "object" && !Array.isArray(chunk)) {
          const updates = Object.values(chunk as Record<string, { streamEvents?: StreamEvent[] }>);
          for (const update of updates) {
            for (const event of update.streamEvents ?? []) {
              yield event;
            }
          }
        }
      }

      const workflowResult =
        lastValueState !== null
          ? this.buildResult(lastValueState, Date.now() - streamStartedAt)
          : null;

      yield {
        type: "progress",
        message: "Workflow complete",
        timestamp: new Date().toISOString(),
        data: workflowResult ? { workflowResult } : undefined,
      };
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "Workflow failed",
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private buildResult(
    state: Awaited<ReturnType<ReturnType<typeof getOptimizationGraph>["invoke"]>>,
    durationMs: number,
  ): WorkflowResult {
    const compression = state.compressionResult;
    const review = state.reviewOutput;

    return {
      requestId: state.requestId,
      status: state.status as WorkflowStatus,
      originalPrompt: state.originalPrompt,
      finalPrompt: state.finalPrompt ?? state.originalPrompt,
      tokensSaved: compression?.analysis.tokensSaved ?? 0,
      compressionRatio: compression?.analysis.compressionRatio ?? 1.0,
      costSavingsUsd: compression?.analysis.costSavingsUsd ?? 0,
      qualityScore: review?.qualityScore ?? 0,
      agentTrace: state.agentTrace,
      streamEvents: state.streamEvents,
      durationMs,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: WorkflowOrchestrator | null = null;
export function getWorkflowOrchestrator(): WorkflowOrchestrator {
  instance ??= new WorkflowOrchestrator();
  return instance;
}
