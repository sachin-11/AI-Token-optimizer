/**
 * Core AI Type Definitions
 *
 * These types form the contract between the application and all AI providers.
 * Every provider must conform to these interfaces — this is the adapter pattern.
 */

// ─── Provider & Model Enums ───────────────────────────────────────────────────

export enum AIProviderName {
  OPENAI = "openai",
  ANTHROPIC = "anthropic",
  GEMINI = "gemini",
}

export enum OpenAIModel {
  GPT_4O = "gpt-4o",
  GPT_4O_MINI = "gpt-4o-mini",
  GPT_4_TURBO = "gpt-4-turbo",
  GPT_35_TURBO = "gpt-3.5-turbo",
}

export enum AnthropicModel {
  CLAUDE_35_SONNET = "claude-3-5-sonnet-20241022",
  CLAUDE_3_HAIKU = "claude-3-haiku-20240307",
  CLAUDE_3_OPUS = "claude-3-opus-20240229",
}

export enum GeminiModel {
  GEMINI_15_PRO = "gemini-1.5-pro",
  GEMINI_15_FLASH = "gemini-1.5-flash",
  GEMINI_10_PRO = "gemini-1.0-pro",
}

export type AIModel = OpenAIModel | AnthropicModel | GeminiModel | string;

// ─── Request / Response Types ─────────────────────────────────────────────────

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionRequest {
  messages: AIMessage[];
  model?: AIModel;
  temperature?: number;       // 0-2, default 0.7
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  userId?: string;            // For per-user rate limiting
  requestId?: string;         // For tracing
}

export interface AICompletionResponse {
  content: string;
  model: string;
  provider: AIProviderName;
  usage: TokenUsage;
  cost: CostBreakdown;
  latencyMs: number;
  fromCache?: boolean;
  requestId?: string;
}

// ─── Token & Cost Types ───────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  currency: "USD";
}

// ─── Streaming Types ──────────────────────────────────────────────────────────

export interface AIStreamChunk {
  type: "delta" | "done" | "error";
  content?: string;
  usage?: TokenUsage;
  cost?: CostBreakdown;
  error?: string;
}

export type AIStreamHandler = (chunk: AIStreamChunk) => void | Promise<void>;

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface AIProviderConfig {
  apiKey: string;
  organizationId?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

// ─── Model Registry Entry ─────────────────────────────────────────────────────

export interface ModelInfo {
  id: AIModel;
  provider: AIProviderName;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPerMToken: number;   // USD per million input tokens
  outputCostPerMToken: number;  // USD per million output tokens
  supportsStreaming: boolean;
  supportsVision: boolean;
  isDeprecated?: boolean;
}

// ─── Fallback Config ──────────────────────────────────────────────────────────

export interface FallbackConfig {
  primary: AIModel;
  fallbacks: AIModel[];
  // Conditions that trigger fallback
  fallbackOn: FallbackTrigger[];
}

export enum FallbackTrigger {
  RATE_LIMIT = "rate_limit",
  TIMEOUT = "timeout",
  PROVIDER_ERROR = "provider_error",
  CONTEXT_TOO_LONG = "context_too_long",
  QUOTA_EXCEEDED = "quota_exceeded",
}

// ─── Provider Interface — the core contract ───────────────────────────────────

export interface IAIProvider {
  readonly name: AIProviderName;
  readonly supportedModels: AIModel[];

  /**
   * Send a completion request and return the full response.
   */
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;

  /**
   * Stream a completion response chunk by chunk.
   */
  stream(
    request: AICompletionRequest,
    onChunk: AIStreamHandler,
  ): Promise<AICompletionResponse>;

  /**
   * Check if this provider supports a given model.
   */
  supportsModel(model: AIModel): boolean;

  /**
   * Check provider health — used by the router for availability.
   */
  healthCheck(): Promise<boolean>;
}
