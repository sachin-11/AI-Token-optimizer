/**
 * Streaming Type Definitions
 *
 * SSE envelope types shared between server (API route) and client (hooks).
 * Keeping them in one file ensures the client and server never drift apart.
 */

import type { AgentName, StreamEvent, WorkflowResult } from "@/types/agent";

// ─── SSE Event Types ──────────────────────────────────────────────────────────

export type SSEEventType =
  | "agent_start"
  | "agent_complete"
  | "supervisor_decision"
  | "progress"
  | "token_count"
  | "compression_delta"
  | "validation_result"
  | "review_result"
  | "complete"
  | "error"
  | "heartbeat";

// ─── SSE Envelope ─────────────────────────────────────────────────────────────

export interface SSEEnvelope<T = unknown> {
  id: string;
  type: SSEEventType;
  data: T;
  timestamp: string;
}

// ─── Typed Payloads ───────────────────────────────────────────────────────────

export interface ProgressPayload {
  message: string;
  agent?: AgentName;
  step: number;
  totalSteps: number;
  percentComplete: number;
}

export interface TokenCountPayload {
  originalTokens: number;
  estimatedSavings: number;
  model: string;
  urgency: "none" | "low" | "medium" | "high" | "critical";
}

export interface CompressionDeltaPayload {
  originalTokens: number;
  currentTokens: number;
  compressionRatio: number;
  percentReduction: number;
  mode: string;
}

export interface ValidationResultPayload {
  isValid: boolean;
  score: number;
  issues: string[];
  recommendation: string;
}

export interface ReviewResultPayload {
  qualityScore: number;
  tokenEfficiencyScore: number;
  decision: string;
  notes: string;
}

export interface CompletePayload extends WorkflowResult {
  // All WorkflowResult fields + streaming metadata
  streamDurationMs: number;
  eventCount: number;
  /**
   * Set when the workflow was NOT run fresh:
   * - "redis"    — exact match found in Redis (sub-ms)
   * - "database" — exact match found in PostgreSQL
   * - "semantic" — semantically similar prompt found via pgvector HNSW search
   */
  servedFromCache?: "redis" | "database" | "semantic";
  /** Only set when servedFromCache === "semantic" — cosine similarity of the matched prompt */
  semanticSimilarity?: number;
}

export interface ErrorPayload {
  message: string;
  code?: string;
  retryable: boolean;
}

// ─── Union of all typed SSE events ───────────────────────────────────────────

export type TypedSSEEvent =
  | SSEEnvelope<ProgressPayload>
  | SSEEnvelope<TokenCountPayload>
  | SSEEnvelope<CompressionDeltaPayload>
  | SSEEnvelope<ValidationResultPayload>
  | SSEEnvelope<ReviewResultPayload>
  | SSEEnvelope<CompletePayload>
  | SSEEnvelope<ErrorPayload>
  | SSEEnvelope<{ message: string }>;

// ─── Streaming State (used by useOptimizationStream hook) ────────────────────

export type StreamingPhase =
  | "idle"
  | "connecting"
  | "analyzing"
  | "compressing"
  | "validating"
  | "reviewing"
  | "complete"
  | "error";

export interface StreamingState {
  phase: StreamingPhase;
  isStreaming: boolean;
  progress: number; // 0-100
  currentAgent: AgentName | null;
  message: string;
  events: TypedSSEEvent[];

  // Progressive results (populated as agents complete)
  tokenCount: TokenCountPayload | null;
  compressionDelta: CompressionDeltaPayload | null;
  validationResult: ValidationResultPayload | null;
  reviewResult: ReviewResultPayload | null;
  finalResult: CompletePayload | null;

  error: string | null;
}

// ─── Optimize Request ─────────────────────────────────────────────────────────

export interface OptimizeStreamRequest {
  prompt: string;
  model: string;
  mode: "safe" | "balanced" | "aggressive";
  targetTokens?: number;
}
