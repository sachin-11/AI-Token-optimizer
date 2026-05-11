/**
 * Semantic Compression Strategy — AGGRESSIVE mode
 *
 * Uses an LLM to semantically compress the prompt while preserving meaning.
 * This is the most powerful strategy but also the most expensive and risky.
 *
 * Why LLM-based compression:
 * - Rule-based strategies can only remove obvious redundancy
 * - Semantic compression can restructure sentences, merge related points,
 *   and express the same intent in fewer tokens
 * - An LLM understands context — it knows what's essential vs decorative
 *
 * Risk mitigation:
 * - Only applied in AGGRESSIVE mode
 * - Output is validated before use
 * - Falls back to rule-based result if LLM compression is worse
 * - Uses a cheap, fast model (gpt-4o-mini) to avoid cost spiral
 */

import "server-only";

import { OptimizationMode, PromptType } from "@/types/compression";
import type { ICompressionStrategy, StrategyContext, StrategyResult } from "@/types/compression";
import { getAIRouter } from "@/services/ai/ai-provider.factory";
import { getTokenCounter } from "@/services/token/token-counter.service";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "SemanticStrategy" });

// ─── Compression Prompts by Type ──────────────────────────────────────────────

function buildCompressionSystemPrompt(promptType: PromptType): string {
  const baseInstruction = `You are an expert prompt compression engine. Your task is to compress the given prompt to use fewer tokens while preserving ALL semantic meaning, intent, and instructions.

Rules:
- Preserve ALL instructions, constraints, and requirements
- Keep ALL technical terms, variable names, code, URLs exactly as-is
- Remove only redundancy, verbosity, and filler words
- Do NOT add new information or change meaning
- Output ONLY the compressed prompt — no explanations, no preamble`;

  const typeSpecific: Partial<Record<PromptType, string>> = {
    [PromptType.CODING]: "\n- Preserve ALL code blocks, function names, and technical syntax exactly\n- Keep ALL variable names and identifiers unchanged",
    [PromptType.AGENT]: "\n- Preserve ALL behavioral constraints and rules\n- Keep role definitions and capability boundaries intact\n- Maintain the logical structure of instructions",
    [PromptType.SYSTEM]: "\n- Preserve ALL persona definitions and behavioral rules\n- Keep ALL capability and limitation statements",
    [PromptType.INSTRUCTION]: "\n- Preserve the logical order of steps\n- Keep ALL numbered items and their sequence",
  };

  return baseInstruction + (typeSpecific[promptType] ?? "");
}

// ─── Semantic Strategy ────────────────────────────────────────────────────────

export class SemanticCompressionStrategy implements ICompressionStrategy {
  readonly name = "semantic-compression";
  readonly description = "LLM-based semantic compression preserving full meaning";
  readonly minimumMode = OptimizationMode.AGGRESSIVE;
  readonly applicableTypes: PromptType[] = []; // All types

  private readonly tokenCounter = getTokenCounter();

  async apply(text: string, context: StrategyContext): Promise<StrategyResult> {
    // Skip very short texts — overhead not worth it
    if (text.split(/\s+/).length < 30) {
      return { text, transformationsApplied: [], tokensRemoved: 0 };
    }

    try {
      const router = getAIRouter();

      const response = await router.complete({
        model: "gpt-4o-mini", // Use cheap model for compression meta-task
        messages: [
          {
            role: "system",
            content: buildCompressionSystemPrompt(context.promptType),
          },
          {
            role: "user",
            content: `Compress this prompt:\n\n${text}`,
          },
        ],
        temperature: 0.1, // Low temperature for deterministic compression
        maxTokens: Math.ceil(text.length / 2), // Output shouldn't exceed input
      });

      const compressed = response.content.trim();

      // Sanity check: if LLM output is longer, skip it
      const [originalCount, compressedCount] = await Promise.all([
        this.tokenCounter.countText(text, context.model),
        this.tokenCounter.countText(compressed, context.model),
      ]);

      if (compressedCount.tokenCount >= originalCount.tokenCount) {
        log.warn(
          { original: originalCount.tokenCount, compressed: compressedCount.tokenCount },
          "Semantic compression produced longer output — skipping",
        );
        return { text, transformationsApplied: ["semantic-skipped-no-gain"], tokensRemoved: 0 };
      }

      const tokensRemoved = originalCount.tokenCount - compressedCount.tokenCount;
      log.info(
        { tokensRemoved, ratio: (compressedCount.tokenCount / originalCount.tokenCount).toFixed(2) },
        "Semantic compression applied",
      );

      return {
        text: compressed,
        transformationsApplied: ["semantic-llm-compression"],
        tokensRemoved,
      };
    } catch (error) {
      log.warn({ err: error }, "Semantic compression failed — using rule-based result");
      return { text, transformationsApplied: ["semantic-failed-fallback"], tokensRemoved: 0 };
    }
  }
}
