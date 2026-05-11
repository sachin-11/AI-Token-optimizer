/**
 * LangGraph Workflow State Definition
 *
 * LangGraph requires a state schema with reducer functions.
 * Reducers define how state updates are merged — critical for correctness.
 *
 * Why reducers matter:
 * - Default behavior: last-write-wins (overwrites)
 * - Arrays need append reducers (errors, trace, events should accumulate)
 * - Scalars need replace reducers (current agent, decision should overwrite)
 *
 * This file is the single source of truth for state shape in the graph.
 */

import "server-only";

import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { nanoid } from "nanoid";

import {
  AgentName,
  OptimizationMode,
  SupervisorDecision,
  WorkflowStatus,
  type AgentError,
  type AgentTraceEntry,
  type OptimizationWorkflowState,
  type ReviewOutput,
  type SemanticValidationOutput,
  type StreamEvent,
  type TokenAnalysisOutput,
} from "@/types/agent";
import type { CompressionResult, PromptType } from "@/types/compression";
import type { AIModel } from "@/types/ai";

// ─── State Annotation ─────────────────────────────────────────────────────────

/**
 * LangGraph state annotation.
 * Each field has a reducer that controls how updates are merged.
 *
 * Append reducers: errors, agentTrace, streamEvents
 * Replace reducers: everything else (last write wins)
 */
export const WorkflowStateAnnotation = Annotation.Root({
  // ── Input (set once, never modified) ──────────────────────────────────────
  requestId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => nanoid(),
  }),
  originalPrompt: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  model: Annotation<AIModel>({
    reducer: (_, next) => next,
    default: () => "gpt-4o",
  }),
  mode: Annotation<OptimizationMode>({
    reducer: (_, next) => next,
    default: () => OptimizationMode.BALANCED,
  }),
  userId: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  targetTokens: Annotation<number | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  // ── Workflow Control ───────────────────────────────────────────────────────
  status: Annotation<WorkflowStatus>({
    reducer: (_, next) => next,
    default: () => WorkflowStatus.PENDING,
  }),
  currentAgent: Annotation<AgentName | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  supervisorDecision: Annotation<SupervisorDecision | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  retryCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  maxRetries: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 2,
  }),

  // ── Accumulating arrays — use append reducer ───────────────────────────────
  errors: Annotation<AgentError[]>({
    // Append new errors to existing list
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),
  agentTrace: Annotation<AgentTraceEntry[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),
  streamEvents: Annotation<StreamEvent[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),

  // ── Agent Outputs (replace on each write) ─────────────────────────────────
  tokenAnalysis: Annotation<TokenAnalysisOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  compressionResult: Annotation<CompressionResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  detectedPromptType: Annotation<PromptType | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  validationOutput: Annotation<SemanticValidationOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  reviewOutput: Annotation<ReviewOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  finalPrompt: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});

// ─── Type Alias ───────────────────────────────────────────────────────────────

export type WorkflowState = typeof WorkflowStateAnnotation.State;

// ─── State Helpers ────────────────────────────────────────────────────────────

/**
 * Build initial state from a workflow request.
 */
export function buildInitialState(
  params: Pick<
    OptimizationWorkflowState,
    "requestId" | "originalPrompt" | "model" | "mode" | "userId" | "targetTokens" | "maxRetries"
  >,
): Partial<WorkflowState> {
  return {
    ...params,
    status: WorkflowStatus.RUNNING,
    currentAgent: null,
    supervisorDecision: null,
    retryCount: 0,
    errors: [],
    agentTrace: [],
    streamEvents: [],
    tokenAnalysis: null,
    compressionResult: null,
    detectedPromptType: null,
    validationOutput: null,
    reviewOutput: null,
    finalPrompt: null,
  };
}

/**
 * Create a stream event — used by all agents to emit progress.
 */
export function createStreamEvent(
  type: StreamEvent["type"],
  message: string,
  options?: {
    agent?: AgentName;
    decision?: SupervisorDecision;
    data?: Record<string, unknown>;
  },
): StreamEvent {
  return {
    type,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  };
}

/**
 * Create a trace entry — used by all agents to record execution.
 */
export function createTraceEntry(
  agent: AgentName,
  startedAt: Date,
  success: boolean,
  inputSummary: string,
  outputSummary: string,
  error?: string,
): AgentTraceEntry {
  const completedAt = new Date();
  return {
    agent,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    success,
    inputSummary,
    outputSummary,
    error,
  };
}
