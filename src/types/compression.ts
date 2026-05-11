/**
 * Compression Engine Type Definitions
 *
 * Separate from tokenizer.ts because compression is a domain concern —
 * it has its own strategies, modes, and pipeline stages.
 */

import type { AIMessage, AIModel } from "@/types/ai";
import type { CompressionAnalysis } from "@/types/tokenizer";

// ─── Optimization Modes ───────────────────────────────────────────────────────

/**
 * Three modes with different risk/reward tradeoffs:
 *
 * SAFE       — Only removes provably redundant content (whitespace, exact dupes)
 *              Risk: minimal. Reduction: 5-15%
 *
 * BALANCED   — Removes redundancy + rewrites verbose phrases
 *              Risk: low. Reduction: 15-35%
 *
 * AGGRESSIVE — Full semantic compression + instruction merging
 *              Risk: moderate (meaning drift possible). Reduction: 35-60%
 */
export enum OptimizationMode {
  SAFE = "safe",
  BALANCED = "balanced",
  AGGRESSIVE = "aggressive",
}

// ─── Prompt Types ─────────────────────────────────────────────────────────────

/**
 * Detected prompt type drives which strategies are applied.
 * A coding prompt needs different compression than a chat prompt.
 */
export enum PromptType {
  GENERAL = "general",
  CODING = "coding",
  AGENT = "agent",
  SYSTEM = "system",
  INSTRUCTION = "instruction",
  TECHNICAL = "technical",
  CONVERSATIONAL = "conversational",
}

// ─── Pipeline Stage ───────────────────────────────────────────────────────────

export interface PipelineStage {
  name: string;
  description: string;
}

export interface StageResult {
  stage: string;
  inputText: string;
  outputText: string;
  tokensRemoved: number;
  transformationsApplied: string[];
  skipped: boolean;
  skipReason?: string;
}

// ─── Compression Request / Response ──────────────────────────────────────────

export interface CompressionRequest {
  /** The text or messages to compress */
  content: string | AIMessage[];
  /** Target model — affects token counting and strategy selection */
  model: AIModel;
  /** Optimization aggressiveness */
  mode: OptimizationMode;
  /** Override auto-detected prompt type */
  promptType?: PromptType;
  /** Target token count (optional — if set, compress until reached) */
  targetTokens?: number;
  /** Preserve these exact strings verbatim (e.g. code blocks, variable names) */
  preservePatterns?: RegExp[];
  /** Request ID for tracing */
  requestId?: string;
}

export interface CompressionResult {
  /** Compressed output */
  compressed: string;
  /** Original input (normalized) */
  original: string;
  /** Token analytics */
  analysis: CompressionAnalysis;
  /** Which mode was used */
  mode: OptimizationMode;
  /** Detected prompt type */
  promptType: PromptType;
  /** Per-stage breakdown for debugging */
  stageResults: StageResult[];
  /** Validation result */
  validation: ValidationResult;
  /** Whether target token count was achieved (if specified) */
  targetAchieved?: boolean;
  requestId?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  /** 0-1 score — how well meaning is preserved */
  meaningPreservationScore: number;
  /** Specific issues found */
  issues: ValidationIssue[];
  /** Whether to use compressed or fall back to original */
  recommendation: "use_compressed" | "use_original" | "use_with_caution";
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: ValidationIssueCode;
  message: string;
}

export enum ValidationIssueCode {
  CRITICAL_CONTENT_REMOVED = "CRITICAL_CONTENT_REMOVED",
  CODE_BLOCK_MODIFIED = "CODE_BLOCK_MODIFIED",
  INSTRUCTION_LOST = "INSTRUCTION_LOST",
  VARIABLE_REMOVED = "VARIABLE_REMOVED",
  URL_REMOVED = "URL_REMOVED",
  NUMBER_CHANGED = "NUMBER_CHANGED",
  MEANING_DRIFT = "MEANING_DRIFT",
  EXCESSIVE_COMPRESSION = "EXCESSIVE_COMPRESSION",
}

// ─── Strategy Interface ───────────────────────────────────────────────────────

/**
 * Strategy Pattern — each compression strategy is a self-contained unit.
 * The pipeline composes strategies based on mode and prompt type.
 */
export interface ICompressionStrategy {
  readonly name: string;
  readonly description: string;
  /** Minimum mode required to activate this strategy */
  readonly minimumMode: OptimizationMode;
  /** Prompt types this strategy applies to (empty = all types) */
  readonly applicableTypes: PromptType[];

  /**
   * Apply the strategy to text.
   * Must be pure — no side effects, no external calls.
   */
  apply(text: string, context: StrategyContext): Promise<StrategyResult>;
}

export interface StrategyContext {
  model: AIModel;
  mode: OptimizationMode;
  promptType: PromptType;
  preservePatterns: RegExp[];
  /** Protected regions that must not be modified */
  protectedRegions: ProtectedRegion[];
}

export interface StrategyResult {
  text: string;
  transformationsApplied: string[];
  tokensRemoved: number;
}

export interface ProtectedRegion {
  placeholder: string;
  original: string;
  type: "code" | "url" | "variable" | "number" | "custom";
}
