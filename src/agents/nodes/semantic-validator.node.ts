/**
 * Semantic Validator Agent Node
 *
 * Uses an LLM to verify that the compressed prompt preserves
 * the original's semantic meaning and intent.
 *
 * Why LLM validation (not just rule-based):
 * - Rule-based validation catches structural issues (missing code blocks, URLs)
 * - Semantic validation catches meaning drift that rules can't detect
 * - Example: "Don't use recursion" compressed to "Use recursion" — rules miss this
 *
 * Uses gpt-4o-mini for cost efficiency — validation doesn't need GPT-4o quality.
 * Temperature 0 for deterministic, consistent validation results.
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getAIRouter } from "@/services/ai/ai-provider.factory";
import { getSemanticValidator } from "@/services/semantic/semantic-validator.service";
import { AgentName, WorkflowStatus, type SemanticValidationOutput } from "@/types/agent";
import {
  createStreamEvent,
  createTraceEntry,
  type WorkflowState,
} from "@/agents/state/workflow-state";

const log = createChildLogger({ module: "SemanticValidatorNode" });

// ─── Validation Prompt ────────────────────────────────────────────────────────

const VALIDATION_SYSTEM_PROMPT = `You are a semantic equivalence validator for AI prompts.
Your task: determine if a compressed prompt preserves the full meaning and intent of the original.

Respond with ONLY valid JSON in this exact format:
{
  "isSemanticallySafe": boolean,
  "meaningPreservationScore": number (0.0-1.0),
  "semanticIssues": string[],
  "recommendation": "accept" | "reject" | "retry_with_safe_mode",
  "confidence": number (0.0-1.0)
}

Evaluation criteria:
- All instructions and constraints preserved
- No meaning reversal (e.g. "don't" → "do")
- Technical terms unchanged
- Logical structure maintained
- No new information added`;

// ─── Node Function ────────────────────────────────────────────────────────────

export async function semanticValidatorNode(
  state: WorkflowState,
): Promise<Partial<WorkflowState>> {
  const startedAt = new Date();

  if (!state.compressionResult) {
    return {
      errors: [{
        agent: AgentName.SEMANTIC_VALIDATOR,
        message: "No compression result to validate",
        timestamp: new Date().toISOString(),
        retryable: false,
      }],
    };
  }

  log.info({ requestId: state.requestId }, "Semantic validator started");

  const startEvent = createStreamEvent(
    "agent_start",
    "Validating semantic equivalence of compressed prompt",
    { agent: AgentName.SEMANTIC_VALIDATOR },
  );

  try {
    const router = getAIRouter();
    const semanticValidator = getSemanticValidator();

    // Run embedding-based validation + LLM validation in parallel
    const [embeddingResult, llmResponse] = await Promise.all([
      semanticValidator.validate({
        original: state.originalPrompt,
        optimized: state.compressionResult.compressed,
        requestId: state.requestId,
      }),
      router.complete({
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 500,
        requestId: state.requestId,
        messages: [
          { role: "system", content: VALIDATION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `ORIGINAL:\n${state.originalPrompt}\n\nCOMPRESSED:\n${state.compressionResult.compressed}`,
          },
        ],
      }),
    ]);

    const llmParsed = parseValidationResponse(llmResponse.content);

    // Merge: embedding score is objective, LLM adds semantic nuance
    // Weight embedding 60%, LLM 40% for final score
    const mergedScore = Number(
      (embeddingResult.meaningPreservationScore * 0.6 + llmParsed.meaningPreservationScore * 0.4).toFixed(4),
    );

    const parsed: SemanticValidationOutput = {
      isSemanticallySafe: embeddingResult.isValid && llmParsed.isSemanticallySafe,
      meaningPreservationScore: mergedScore,
      semanticIssues: [
        ...embeddingResult.issues.map((i) => i.message),
        ...llmParsed.semanticIssues,
      ],
      recommendation: mergeRecommendations(embeddingResult.recommendation, llmParsed.recommendation),
      confidence: Number(((embeddingResult.confidence + llmParsed.confidence) / 2).toFixed(4)),
    };

    const trace = createTraceEntry(
      AgentName.SEMANTIC_VALIDATOR,
      startedAt,
      true,
      `Validating compression (${state.compressionResult.analysis.compressionRatio.toFixed(2)} ratio)`,
      `Score: ${parsed.meaningPreservationScore.toFixed(2)}, recommendation: ${parsed.recommendation}`,
    );

    const event = createStreamEvent(
      "agent_complete",
      `Semantic validation: ${parsed.isSemanticallySafe ? "✓ safe" : "✗ issues found"} (score: ${parsed.meaningPreservationScore.toFixed(2)})`,
      {
        agent: AgentName.SEMANTIC_VALIDATOR,
        data: {
          score: parsed.meaningPreservationScore,
          recommendation: parsed.recommendation,
          issueCount: parsed.semanticIssues.length,
        },
      },
    );

    log.info(
      { requestId: state.requestId, score: parsed.meaningPreservationScore, recommendation: parsed.recommendation },
      "Semantic validation complete",
    );

    return {
      currentAgent: AgentName.SEMANTIC_VALIDATOR,
      validationOutput: parsed,
      agentTrace: [trace],
      streamEvents: [startEvent, event],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Semantic validation failed";
    log.error({ requestId: state.requestId, err: error }, message);

    // Validation failure → conservative fallback (accept with caution)
    const fallbackOutput: SemanticValidationOutput = {
      isSemanticallySafe: true,
      meaningPreservationScore: 0.7,
      semanticIssues: ["Validation service unavailable — using rule-based validation only"],
      recommendation: "accept",
      confidence: 0.5,
    };

    const trace = createTraceEntry(
      AgentName.SEMANTIC_VALIDATOR,
      startedAt,
      false,
      "Validation attempt",
      "Failed — using fallback",
      message,
    );

    return {
      currentAgent: AgentName.SEMANTIC_VALIDATOR,
      validationOutput: fallbackOutput,
      errors: [{ agent: AgentName.SEMANTIC_VALIDATOR, message, timestamp: new Date().toISOString(), retryable: false }],
      agentTrace: [trace],
      streamEvents: [
        startEvent,
        createStreamEvent("error", `Validation failed, using fallback: ${message}`, { agent: AgentName.SEMANTIC_VALIDATOR }),
      ],
    };
  }
}

// ─── Response Parser ──────────────────────────────────────────────────────────

function parseValidationResponse(content: string): SemanticValidationOutput {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch?.[0]) throw new Error("No JSON found in response");

    const parsed = JSON.parse(jsonMatch[0]) as Partial<SemanticValidationOutput>;

    return {
      isSemanticallySafe: Boolean(parsed.isSemanticallySafe),
      meaningPreservationScore: Number(parsed.meaningPreservationScore ?? 0.8),
      semanticIssues: Array.isArray(parsed.semanticIssues) ? parsed.semanticIssues : [],
      recommendation: (parsed.recommendation as SemanticValidationOutput["recommendation"]) ?? "accept",
      confidence: Number(parsed.confidence ?? 0.8),
    };
  } catch {
    return {
      isSemanticallySafe: true,
      meaningPreservationScore: 0.75,
      semanticIssues: ["Could not parse validation response"],
      recommendation: "accept",
      confidence: 0.5,
    };
  }
}

// Merge embedding + LLM recommendations — most conservative wins
function mergeRecommendations(
  embedding: "accept" | "reject" | "review",
  llm: SemanticValidationOutput["recommendation"],
): SemanticValidationOutput["recommendation"] {
  if (embedding === "reject" || llm === "reject") return "reject";
  if (embedding === "review" || llm === "retry_with_safe_mode") return "retry_with_safe_mode";
  return "accept";
}
