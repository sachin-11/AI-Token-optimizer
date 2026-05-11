/**
 * Workflow Tracer
 *
 * Instruments the LangGraph multi-agent optimization workflow.
 * Creates a parent span for the full workflow and child spans per agent.
 *
 * Trace structure:
 *   optimization.workflow (root)
 *     ├── optimization.agent.token_analyzer
 *     ├── optimization.agent.compression
 *     ├── optimization.agent.semantic_validator
 *     └── optimization.agent.reviewer
 *
 * Each span carries:
 * - Agent name, duration, success/failure
 * - Token counts, compression ratio
 * - Model and provider used
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { tracer, type Span } from "@/observability/tracer";
import { recordOptimizationResult } from "@/observability/ai-metrics";
import { registry } from "@/observability/metrics";
import { AgentName } from "@/types/agent";
import type { WorkflowRequest, WorkflowResult, AgentTraceEntry } from "@/types/agent";

const log = createChildLogger({ module: "WorkflowTracer" });

// ─── Workflow Tracer ──────────────────────────────────────────────────────────

export class WorkflowTracer {
  /**
   * Wrap a workflow execution with full tracing.
   */
  async traceWorkflow(
    request: WorkflowRequest,
    fn: () => Promise<WorkflowResult>,
  ): Promise<WorkflowResult> {
    return tracer.trace(
      "optimization.workflow",
      async (span) => {
        span
          .setAttribute("optimization.model",      request.model as string)
          .setAttribute("optimization.mode",       request.mode)
          .setAttribute("optimization.request_id", request.requestId ?? "")
          .setAttribute("optimization.prompt_len", request.prompt.length);

        log.info(
          {
            requestId: request.requestId,
            model:     request.model,
            mode:      request.mode,
            promptLen: request.prompt.length,
          },
          "workflow:start",
        );

        const result = await fn();

        // Enrich span with result data
        span
          .setAttribute("optimization.status",           result.status)
          .setAttribute("optimization.tokens_saved",     result.tokensSaved)
          .setAttribute("optimization.compression_ratio",result.compressionRatio)
          .setAttribute("optimization.quality_score",    result.qualityScore)
          .setAttribute("optimization.duration_ms",      result.durationMs);

        if (result.status === "failed") {
          span.setStatus("error", "Workflow failed");
        }

        // Record agent-level spans from trace entries
        this.recordAgentSpans(span, result.agentTrace);

        // Record metrics
        recordOptimizationResult(result);

        log.info(
          {
            requestId:        result.requestId,
            status:           result.status,
            tokensSaved:      result.tokensSaved,
            compressionRatio: result.compressionRatio,
            qualityScore:     result.qualityScore,
            durationMs:       result.durationMs,
            agentCount:       result.agentTrace.length,
          },
          "workflow:complete",
        );

        return result;
      },
      {
        "optimization.model": request.model as string,
        "optimization.mode":  request.mode,
      },
    );
  }

  /**
   * Log structured agent trace entries as child spans.
   */
  private recordAgentSpans(parentSpan: Span, agentTrace: AgentTraceEntry[]): void {
    for (const entry of agentTrace) {
      const childSpan = parentSpan.child(`optimization.agent.${entry.agent}`, {
        "agent.name":        entry.agent,
        "agent.duration_ms": entry.durationMs,
        "agent.success":     entry.success,
      });

      if (!entry.success && entry.error) {
        childSpan.setStatus("error", entry.error);
      } else {
        childSpan.setStatus("ok");
      }

      childSpan.end();

      // Per-agent metrics
      registry.inc("optimization_total", {
        agent:  entry.agent,
        status: entry.success ? "success" : "error",
      });
    }
  }
}

// ─── Agent Timing Logger ──────────────────────────────────────────────────────

/**
 * Lightweight timing utility for individual agent nodes.
 * Use inside agent node functions for fine-grained timing.
 */
export function createAgentTimer(agentName: AgentName) {
  const start = Date.now();

  return {
    end(success: boolean, metadata?: Record<string, unknown>) {
      const durationMs = Date.now() - start;

      log.info(
        {
          agent:     agentName,
          durationMs,
          success,
          ...metadata,
        },
        `agent:${success ? "complete" : "failed"}`,
      );

      registry.observe("optimization_duration_ms", durationMs, {
        agent:  agentName,
        status: success ? "success" : "error",
      });

      return durationMs;
    },
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: WorkflowTracer | null = null;
export function getWorkflowTracer(): WorkflowTracer {
  instance ??= new WorkflowTracer();
  return instance;
}
