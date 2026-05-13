/**
 * POST /api/v1/optimize/stream
 *
 * Streams optimization progress via Server-Sent Events.
 * Identical prompt + model + mode (+ targetTokens) is resolved in order:
 *   Redis → PostgreSQL → full workflow (then back-fill Redis + DB for logged-in users).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { OptimizationMode as DbOptimizationMode } from "@prisma/client";

import { nanoid } from "nanoid";

import { createSSEStream, SSE_HEADERS } from "@/lib/sse";
import { auth } from "@/lib/auth";
import { getWorkflowOrchestrator } from "@/agents/graph/workflow-orchestrator";
import { AgentName, WorkflowStatus, type WorkflowResult } from "@/types/agent";
import { OptimizationMode } from "@/types/compression";
import { CacheKeyFactory } from "@/services/cache/cache-key.factory";
import {
  getOptimizationWorkflowCache,
  optimizationRowToWorkflowResult,
} from "@/services/cache/optimization-workflow-cache.service";
import { getWorkflowSemanticCache } from "@/services/cache/workflow-semantic-cache.service";
import { getOptimizationResultRepository } from "@/repositories/optimization-result.repository";
import type {
  CompressionDeltaPayload,
  CompletePayload,
  ProgressPayload,
  TokenCountPayload,
  ValidationResultPayload,
  ReviewResultPayload,
  SSEEventType,
} from "@/types/streaming";

// ─── Request Schema ───────────────────────────────────────────────────────────

const requestSchema = z.object({
  prompt: z.string().min(1).max(32_000),
  model: z.string().default("gpt-4o"),
  mode: z.enum(["safe", "balanced", "aggressive"]).default("balanced"),
  targetTokens: z.number().int().positive().optional(),
});

// ─── Agent → Step mapping for progress % ─────────────────────────────────────

const AGENT_STEPS: Record<string, number> = {
  [AgentName.TOKEN_ANALYZER]: 1,
  [AgentName.COMPRESSION]: 2,
  [AgentName.SEMANTIC_VALIDATOR]: 3,
  [AgentName.REVIEWER]: 4,
};
const TOTAL_STEPS = 4;

function bodyModeToPrisma(mode: z.infer<typeof requestSchema>["mode"]): DbOptimizationMode {
  const m: Record<typeof mode, DbOptimizationMode> = {
    safe: "SAFE",
    balanced: "BALANCED",
    aggressive: "AGGRESSIVE",
  };
  return m[mode];
}

function deriveTokenMetrics(wf: WorkflowResult): {
  originalTokens: number;
  currentTokens: number;
  percentReduction: number;
} {
  const r = wf.compressionRatio;
  let originalTokens: number;
  if (r > 0 && r < 1 && Number.isFinite(wf.tokensSaved)) {
    originalTokens = Math.max(1, Math.round(wf.tokensSaved / (1 - r)));
  } else {
    originalTokens = Math.max(wf.tokensSaved, Math.ceil(wf.originalPrompt.length / 4), 1);
  }
  const currentTokens = Math.max(0, originalTokens - wf.tokensSaved);
  const percentReduction =
    originalTokens > 0 ? ((originalTokens - currentTokens) / originalTokens) * 100 : 0;
  return { originalTokens, currentTokens, percentReduction };
}

function emitCachedOptimizationReplay(
  emit: <T>(type: SSEEventType, data: T) => void,
  body: z.infer<typeof requestSchema>,
  wf: WorkflowResult,
  source: "redis" | "database" | "semantic",
  streamStart: number,
  /** Only provided when source === "semantic" */
  similarity?: number,
): CompletePayload {
  const { originalTokens, currentTokens, percentReduction } = deriveTokenMetrics(wf);

  const progressMessage =
    source === "redis"
      ? "Loaded from cache (Redis)…"
      : source === "database"
        ? "Loaded from database…"
        : `Semantically similar result found (${Math.round((similarity ?? 0) * 100)}% match) — skipping pipeline…`;

  emit<ProgressPayload>("progress", {
    message: progressMessage,
    step: 0,
    totalSteps: TOTAL_STEPS,
    percentComplete: 5,
  });

  const step1 = AGENT_STEPS[AgentName.TOKEN_ANALYZER] ?? 1;
  emit<ProgressPayload>("agent_start", {
    message: "Token analysis (cached result)",
    agent: AgentName.TOKEN_ANALYZER,
    step: step1,
    totalSteps: TOTAL_STEPS,
    percentComplete: Math.round((step1 / TOTAL_STEPS) * 80),
  });

  emit<TokenCountPayload>("token_count", {
    originalTokens,
    estimatedSavings: wf.tokensSaved,
    model: body.model,
    urgency: "none",
  });

  emit<ProgressPayload>("agent_complete", {
    message: "Token analysis (cached)",
    agent: AgentName.TOKEN_ANALYZER,
    step: step1,
    totalSteps: TOTAL_STEPS,
    percentComplete: Math.round((step1 / TOTAL_STEPS) * 80),
  });

  const step2 = AGENT_STEPS[AgentName.COMPRESSION] ?? 2;
  emit<ProgressPayload>("agent_start", {
    message: "Compression (cached result)",
    agent: AgentName.COMPRESSION,
    step: step2,
    totalSteps: TOTAL_STEPS,
    percentComplete: Math.round((step2 / TOTAL_STEPS) * 80),
  });

  emit<CompressionDeltaPayload>("compression_delta", {
    originalTokens,
    currentTokens,
    compressionRatio: originalTokens > 0 ? currentTokens / originalTokens : 1,
    percentReduction,
    mode: body.mode,
  });

  emit<ProgressPayload>("agent_complete", {
    message: "Compression (cached)",
    agent: AgentName.COMPRESSION,
    step: step2,
    totalSteps: TOTAL_STEPS,
    percentComplete: Math.round((step2 / TOTAL_STEPS) * 80),
  });

  const step3 = AGENT_STEPS[AgentName.SEMANTIC_VALIDATOR] ?? 3;
  emit<ValidationResultPayload>("validation_result", {
    isValid: true,
    score: 1,
    issues: [],
    recommendation: "accept",
  });
  emit<ProgressPayload>("agent_complete", {
    message: "Validation (cached)",
    agent: AgentName.SEMANTIC_VALIDATOR,
    step: step3,
    totalSteps: TOTAL_STEPS,
    percentComplete: Math.round((step3 / TOTAL_STEPS) * 80),
  });

  const step4 = AGENT_STEPS[AgentName.REVIEWER] ?? 4;
  emit<ReviewResultPayload>("review_result", {
    qualityScore: wf.qualityScore,
    tokenEfficiencyScore: wf.qualityScore,
    decision: "use_compressed",
    notes: "Cached optimization replay",
  });
  emit<ProgressPayload>("agent_complete", {
    message: "Review (cached)",
    agent: AgentName.REVIEWER,
    step: step4,
    totalSteps: TOTAL_STEPS,
    percentComplete: Math.round((step4 / TOTAL_STEPS) * 80),
  });

  const complete: CompletePayload = {
    ...wf,
    streamDurationMs: Date.now() - streamStart,
    eventCount: 12,
    servedFromCache: source,
    ...(source === "semantic" && similarity !== undefined && { semanticSimilarity: similarity }),
  };
  emit<CompletePayload>("complete", complete);
  return complete;
}

async function persistFreshOptimization(
  userId: string | undefined,
  inputHash: string,
  body: z.infer<typeof requestSchema>,
  result: CompletePayload,
): Promise<void> {
  if (result.status !== WorkflowStatus.COMPLETED) return;

  const wfCache = getOptimizationWorkflowCache();
  const base: WorkflowResult = {
    requestId: result.requestId,
    status: result.status,
    originalPrompt: result.originalPrompt,
    finalPrompt: result.finalPrompt,
    tokensSaved: result.tokensSaved,
    compressionRatio: result.compressionRatio,
    costSavingsUsd: result.costSavingsUsd,
    qualityScore: result.qualityScore,
    agentTrace: result.agentTrace,
    streamEvents: result.streamEvents,
    durationMs: result.durationMs,
  };

  // 1. Exact-match cache (Redis + DB)
  await wfCache.setRedis(inputHash, body.model, base);

  // 2. Semantic cache — store embedding + result for future similar prompts.
  //    Done asynchronously and non-fatally so it never delays the response.
  void getWorkflowSemanticCache()
    .store({ prompt: body.prompt, model: body.model, mode: body.mode, result: base })
    .catch(() => {
      /* non-fatal */
    });

  if (!userId) return;

  const repo = getOptimizationResultRepository();
  const existing = await repo.findLatestCompletedByInputHash(inputHash);
  if (existing) return;

  await repo.createCompletedOptimization({
    userId,
    requestId: result.requestId,
    inputHash,
    model: body.model,
    mode: bodyModeToPrisma(body.mode),
    originalPrompt: body.prompt,
    optimizedPrompt: result.finalPrompt,
    savedTokens: result.tokensSaved,
    compressionRatio: result.compressionRatio,
    savedCostUsd: result.costSavingsUsd,
    qualityScore: result.qualityScore,
    processingTimeMs: result.durationMs,
    agentTrace: result.agentTrace as unknown as Prisma.InputJsonValue,
  });
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  let body: z.infer<typeof requestSchema>;
  try {
    const raw = (await req.json()) as unknown;
    const result = requestSchema.safeParse(raw);
    if (!result.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    body = result.data;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id;

  const inputHash = CacheKeyFactory.hashOptimizationInput(
    body.prompt,
    body.model,
    body.mode,
    body.targetTokens,
  );

  const orchestrator = getWorkflowOrchestrator();
  const wfCache = getOptimizationWorkflowCache();
  const optRepo = getOptimizationResultRepository();
  const abortSignal = req.signal;

  const stream = createSSEStream(
    async (emit) => {
      let finalResult: CompletePayload | null = null;
      const streamStart = Date.now();
      let eventCount = 0;

      const modeMap: Record<string, OptimizationMode> = {
        safe: OptimizationMode.SAFE,
        balanced: OptimizationMode.BALANCED,
        aggressive: OptimizationMode.AGGRESSIVE,
      };

      emit<ProgressPayload>("progress", {
        message: "Starting optimization workflow…",
        step: 0,
        totalSteps: TOTAL_STEPS,
        percentComplete: 0,
      });

      // ── Cache lookup tier 1: exact Redis hit ─────────────────────────────
      const fromRedis = await wfCache.getFromRedis(inputHash);
      if (fromRedis) {
        finalResult = emitCachedOptimizationReplay(emit, body, fromRedis, "redis", streamStart);
        return;
      }

      // ── Cache lookup tier 2: exact PostgreSQL hit ─────────────────────────
      const dbRow = await optRepo.findLatestCompletedByInputHash(inputHash);
      if (dbRow) {
        const wf = optimizationRowToWorkflowResult(dbRow);
        void wfCache.setRedis(inputHash, body.model, wf);
        finalResult = emitCachedOptimizationReplay(emit, body, wf, "database", streamStart);
        return;
      }

      // ── Cache lookup tier 3: semantic similarity (ML layer) ──────────────
      // Embed the incoming prompt and search pgvector for a cached result
      // from a semantically similar past optimization (cosine >= 0.92).
      // On hit we return immediately — no 4-agent pipeline needed.
      const semHit = await getWorkflowSemanticCache().findSimilar({
        prompt: body.prompt,
        model: body.model,
        mode: body.mode,
      });
      if (semHit) {
        // Adapt the cached result to the current request:
        // - new requestId for traceability
        // - originalPrompt updated to what the user actually submitted
        const adaptedResult: WorkflowResult = {
          ...semHit.result,
          requestId: nanoid(),
          originalPrompt: body.prompt,
        };
        finalResult = emitCachedOptimizationReplay(
          emit,
          body,
          adaptedResult,
          "semantic",
          streamStart,
          semHit.similarity,
        );
        return;
      }

      for await (const event of orchestrator.stream({
        prompt: body.prompt,
        model: body.model,
        mode: modeMap[body.mode] ?? OptimizationMode.BALANCED,
        targetTokens: body.targetTokens,
      })) {
        if (abortSignal?.aborted) break;
        eventCount++;

        switch (event.type) {
          case "agent_start": {
            const step = AGENT_STEPS[event.agent ?? ""] ?? 0;
            emit<ProgressPayload>("agent_start", {
              message: event.message,
              agent: event.agent,
              step,
              totalSteps: TOTAL_STEPS,
              percentComplete: Math.round((step / TOTAL_STEPS) * 80),
            });
            break;
          }

          case "agent_complete": {
            const step = AGENT_STEPS[event.agent ?? ""] ?? 0;
            const data = event.data ?? {};

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
                currentTokens: (data["compressedTokens"] as number) ?? 0,
                compressionRatio: 1 - ((data["percentReduction"] as number) ?? 0) / 100,
                percentReduction: (data["percentReduction"] as number) ?? 0,
                mode: (data["mode"] as string) ?? body.mode,
              });
            }

            if (event.agent === AgentName.SEMANTIC_VALIDATOR) {
              emit<ValidationResultPayload>("validation_result", {
                isValid: ((data["score"] as number) ?? 0) >= 0.8,
                score: (data["score"] as number) ?? 0,
                issues: [],
                recommendation: (data["recommendation"] as string) ?? "accept",
              });
            }

            if (event.agent === AgentName.REVIEWER) {
              emit<ReviewResultPayload>("review_result", {
                qualityScore: (data["qualityScore"] as number) ?? 0,
                tokenEfficiencyScore: (data["tokenEfficiencyScore"] as number) ?? 0,
                decision: (data["finalDecision"] as string) ?? "use_compressed",
                notes: event.message,
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
              const workflowResult = event.data?.workflowResult;
              if (
                workflowResult &&
                typeof workflowResult === "object" &&
                "requestId" in workflowResult &&
                "finalPrompt" in workflowResult
              ) {
                finalResult = {
                  ...(workflowResult as WorkflowResult),
                  streamDurationMs: Date.now() - streamStart,
                  eventCount,
                };
              } else {
                const result = await orchestrator.run({
                  prompt: body.prompt,
                  model: body.model,
                  mode: modeMap[body.mode] ?? OptimizationMode.BALANCED,
                  targetTokens: body.targetTokens,
                });

                finalResult = {
                  ...result,
                  streamDurationMs: Date.now() - streamStart,
                  eventCount,
                };
              }

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

      if (finalResult && !finalResult.servedFromCache) {
        try {
          await persistFreshOptimization(userId, inputHash, body, finalResult);
        } catch {
          // Non-fatal: optimization still returned to client
        }
      }

      if (!finalResult) {
        emit<ProgressPayload>("progress", {
          message: "Finalizing…",
          step: TOTAL_STEPS,
          totalSteps: TOTAL_STEPS,
          percentComplete: 100,
        });
      }
    },
    { signal: abortSignal },
  );

  return new Response(stream, { headers: SSE_HEADERS });
}
