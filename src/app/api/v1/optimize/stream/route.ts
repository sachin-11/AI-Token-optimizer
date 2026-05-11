/**
 * POST /api/v1/optimize/stream
 *
 * Streams optimization progress via Server-Sent Events.
 * Each agent completion emits a typed SSE event so the UI
 * can update progressively without waiting for the full result.
 *
 * Flow:
 *   client POST → SSE stream opens → agent events flow →
 *   complete event with final result → stream closes
 */

import { NextRequest } from "next/server";
import { z } from "zod";

import { createSSEStream, SSE_HEADERS } from "@/lib/sse";
import { getWorkflowOrchestrator } from "@/agents/graph/workflow-orchestrator";
import { AgentName, WorkflowStatus } from "@/types/agent";
import { OptimizationMode } from "@/types/compression";
import type {
  CompressionDeltaPayload,
  CompletePayload,
  ProgressPayload,
  TokenCountPayload,
  ValidationResultPayload,
  ReviewResultPayload,
} from "@/types/streaming";

// ─── Request Schema ───────────────────────────────────────────────────────────

const requestSchema = z.object({
  prompt:       z.string().min(1).max(32_000),
  model:        z.string().default("gpt-4o"),
  mode:         z.enum(["safe", "balanced", "aggressive"]).default("balanced"),
  targetTokens: z.number().int().positive().optional(),
});

// ─── Agent → Step mapping for progress % ─────────────────────────────────────

const AGENT_STEPS: Record<string, number> = {
  [AgentName.TOKEN_ANALYZER]:     1,
  [AgentName.COMPRESSION]:        2,
  [AgentName.SEMANTIC_VALIDATOR]: 3,
  [AgentName.REVIEWER]:           4,
};
const TOTAL_STEPS = 4;

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // Parse body
  let body: z.infer<typeof requestSchema>;
  try {
    const raw = await req.json() as unknown;
    const result = requestSchema.safeParse(raw);
    if (!result.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    body = result.data;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orchestrator = getWorkflowOrchestrator();
  const abortSignal = req.signal;

  const stream = createSSEStream(async (emit) => {
    // ── Initial progress ──────────────────────────────────────────────────
    emit<ProgressPayload>("progress", {
      message: "Starting optimization workflow…",
      step: 0,
      totalSteps: TOTAL_STEPS,
      percentComplete: 0,
    });

    // ── Stream workflow events ────────────────────────────────────────────
    const modeMap: Record<string, OptimizationMode> = {
      safe:       OptimizationMode.SAFE,
      balanced:   OptimizationMode.BALANCED,
      aggressive: OptimizationMode.AGGRESSIVE,
    };

    let finalResult: CompletePayload | null = null;
    const streamStart = Date.now();
    let eventCount = 0;

    for await (const event of orchestrator.stream({
      prompt:       body.prompt,
      model:        body.model,
      mode:         modeMap[body.mode] ?? OptimizationMode.BALANCED,
      targetTokens: body.targetTokens,
    })) {
      if (abortSignal?.aborted) break;
      eventCount++;

      // ── Map workflow events to typed SSE events ───────────────────────
      switch (event.type) {
        case "agent_start": {
          const step = AGENT_STEPS[event.agent ?? ""] ?? 0;
          emit<ProgressPayload>("agent_start", {
            message: event.message,
            agent: event.agent,
            step,
            totalSteps: TOTAL_STEPS,
            percentComplete: Math.round((step / TOTAL_STEPS) * 80), // 0-80% during agents
          });
          break;
        }

        case "agent_complete": {
          const step = AGENT_STEPS[event.agent ?? ""] ?? 0;
          const data = event.data ?? {};

          // Emit agent-specific typed events
          if (event.agent === AgentName.TOKEN_ANALYZER) {
            emit<TokenCountPayload>("token_count", {
              originalTokens: (data["tokenCount"] as number) ?? 0,
              estimatedSavings: 0,
              model: body.model,
              urgency: (data["urgency"] as TokenCountPayload["urgency"]) ?? "none",
            });
          }

          if (event.agent === AgentName.COMPRESSION) {
            emit<CompressionDeltaPayload>("compression_delta", {
              originalTokens: (data["originalTokens"] as number) ?? 0,
              currentTokens:  (data["compressedTokens"] as number) ?? 0,
              compressionRatio: 1 - ((data["percentReduction"] as number) ?? 0) / 100,
              percentReduction: (data["percentReduction"] as number) ?? 0,
              mode: (data["mode"] as string) ?? body.mode,
            });
          }

          if (event.agent === AgentName.SEMANTIC_VALIDATOR) {
            emit<ValidationResultPayload>("validation_result", {
              isValid:        (data["score"] as number ?? 0) >= 0.8,
              score:          (data["score"] as number) ?? 0,
              issues:         [],
              recommendation: (data["recommendation"] as string) ?? "accept",
            });
          }

          if (event.agent === AgentName.REVIEWER) {
            emit<ReviewResultPayload>("review_result", {
              qualityScore:         (data["qualityScore"] as number) ?? 0,
              tokenEfficiencyScore: (data["tokenEfficiencyScore"] as number) ?? 0,
              decision:             (data["finalDecision"] as string) ?? "use_compressed",
              notes:                event.message,
            });
          }

          emit<ProgressPayload>("agent_complete", {
            message: event.message,
            agent: event.agent,
            step,
            totalSteps: TOTAL_STEPS,
            percentComplete: Math.round((step / TOTAL_STEPS) * 80),
          });
          break;
        }

        case "progress": {
          if (event.message === "Workflow complete") {
            // Run non-streaming to get final result
            const result = await orchestrator.run({
              prompt:       body.prompt,
              model:        body.model,
              mode:         modeMap[body.mode] ?? OptimizationMode.BALANCED,
              targetTokens: body.targetTokens,
            });

            finalResult = {
              ...result,
              streamDurationMs: Date.now() - streamStart,
              eventCount,
            };

            emit<CompletePayload>("complete", finalResult);
          } else {
            emit<ProgressPayload>("progress", {
              message: event.message,
              step: 0,
              totalSteps: TOTAL_STEPS,
              percentComplete: 5,
            });
          }
          break;
        }

        case "error": {
          emit("error", { message: event.message, retryable: false });
          break;
        }
      }
    }

    // Ensure complete event is always sent
    if (!finalResult) {
      emit<ProgressPayload>("progress", {
        message: "Finalizing…",
        step: TOTAL_STEPS,
        totalSteps: TOTAL_STEPS,
        percentComplete: 100,
      });
    }
  }, { signal: abortSignal });

  return new Response(stream, { headers: SSE_HEADERS });
}
