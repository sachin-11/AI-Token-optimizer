/**
 * Agent Workflow Type Definitions
 *
 * Why separate from ai.ts and compression.ts:
 * - Agent state is a superset of both — it carries the full workflow context
 * - LangGraph state must be serializable (for checkpointing/resumability)
 * - Keeping agent types isolated prevents circular imports
 */

import type { AIModel } from "@/types/ai";
import type { CompressionResult, OptimizationMode, PromptType } from "@/types/compression";
import type { ContextWindowAnalysis } from "@/types/tokenizer";

// ─── Workflow Status ──────────────────────────────────────────────────────────

export enum WorkflowStatus {
  PENDING    = "pending",
  RUNNING    = "running",
  COMPLETED  = "completed",
  FAILED     = "failed",
  CANCELLED  = "cancelled",
}

// ─── Agent Names ──────────────────────────────────────────────────────────────

export enum AgentName {
  SUPERVISOR         = "supervisor",
  COMPRESSION        = "compression",
  SEMANTIC_VALIDATOR = "semantic_validator",
  TOKEN_ANALYZER     = "token_analyzer",
  REVIEWER           = "reviewer",
}

// ─── Routing Decisions ────────────────────────────────────────────────────────

/**
 * Supervisor routing decisions — what the supervisor tells the graph to do next.
 * These map directly to LangGraph edge conditions.
 */
export enum SupervisorDecision {
  ANALYZE_TOKENS    = "analyze_tokens",
  COMPRESS          = "compress",
  VALIDATE          = "validate",
  REVIEW            = "review",
  RETRY_COMPRESSION = "retry_compression",
  COMPLETE          = "complete",
  FAIL              = "fail",
}

// ─── Shared Graph State ───────────────────────────────────────────────────────

/**
 * The single state object that flows through the entire graph.
 *
 * Why one shared state:
 * - LangGraph nodes read from and write to this state
 * - Immutable updates (each node returns a partial state)
 * - Serializable for checkpointing and resumability
 * - Full audit trail — every agent's output is preserved
 */
export interface OptimizationWorkflowState {
  // ── Input ──────────────────────────────────────────────────────────────────
  requestId: string;
  originalPrompt: string;
  model: AIModel;
  mode: OptimizationMode;
  userId?: string;
  targetTokens?: number;

  // ── Workflow Control ───────────────────────────────────────────────────────
  status: WorkflowStatus;
  currentAgent: AgentName | null;
  supervisorDecision: SupervisorDecision | null;
  /** How many times compression has been retried */
  retryCount: number;
  maxRetries: number;
  /** Error messages from failed agents */
  errors: AgentError[];

  // ── Token Analysis Output ──────────────────────────────────────────────────
  tokenAnalysis: TokenAnalysisOutput | null;

  // ── Compression Output ─────────────────────────────────────────────────────
  compressionResult: CompressionResult | null;
  /** Detected prompt type from analyzer */
  detectedPromptType: PromptType | null;

  // ── Validation Output ──────────────────────────────────────────────────────
  validationOutput: SemanticValidationOutput | null;

  // ── Review Output ──────────────────────────────────────────────────────────
  reviewOutput: ReviewOutput | null;

  // ── Final Output ───────────────────────────────────────────────────────────
  finalPrompt: string | null;
  /** Full audit trail of agent executions */
  agentTrace: AgentTraceEntry[];

  // ── Streaming ─────────────────────────────────────────────────────────────
  streamEvents: StreamEvent[];
}

// ─── Agent Output Types ───────────────────────────────────────────────────────

export interface TokenAnalysisOutput {
  originalTokenCount: number;
  contextWindowAnalysis: ContextWindowAnalysis;
  estimatedCostUsd: number;
  recommendedMode: OptimizationMode;
  /** Whether compression is needed at all */
  compressionNeeded: boolean;
  compressionUrgency: "none" | "low" | "medium" | "high" | "critical";
}

export interface SemanticValidationOutput {
  isSemanticallySafe: boolean;
  /** 0-1 score */
  meaningPreservationScore: number;
  /** Specific semantic issues found by LLM analysis */
  semanticIssues: string[];
  /** Whether to proceed with compressed or revert to original */
  recommendation: "accept" | "reject" | "retry_with_safe_mode";
  confidence: number;
}

export interface ReviewOutput {
  approved: boolean;
  qualityScore: number;       // 0-100
  tokenEfficiencyScore: number; // 0-100
  suggestions: string[];
  finalDecision: "use_compressed" | "use_original" | "retry";
  reviewNotes: string;
}

// ─── Trace & Streaming ────────────────────────────────────────────────────────

export interface AgentTraceEntry {
  agent: AgentName;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  inputSummary: string;
  outputSummary: string;
  error?: string;
}

export interface AgentError {
  agent: AgentName;
  message: string;
  timestamp: string;
  retryable: boolean;
}

export interface StreamEvent {
  type: "agent_start" | "agent_complete" | "supervisor_decision" | "progress" | "error";
  agent?: AgentName;
  decision?: SupervisorDecision;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

// ─── Workflow Request / Response ──────────────────────────────────────────────

export interface WorkflowRequest {
  prompt: string;
  model: AIModel;
  mode: OptimizationMode;
  userId?: string;
  targetTokens?: number;
  requestId?: string;
  maxRetries?: number;
}

export interface WorkflowResult {
  requestId: string;
  status: WorkflowStatus;
  originalPrompt: string;
  finalPrompt: string;
  tokensSaved: number;
  compressionRatio: number;
  costSavingsUsd: number;
  qualityScore: number;
  agentTrace: AgentTraceEntry[];
  streamEvents: StreamEvent[];
  durationMs: number;
}
