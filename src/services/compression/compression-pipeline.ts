/**
 * Compression Pipeline
 *
 * Orchestrates the full compression workflow using the Strategy pattern.
 *
 * Pipeline stages (in order):
 * 1. Analyze   — detect prompt type, extract characteristics
 * 2. Protect   — extract code/URLs/variables into placeholders
 * 3. Strategize — select and apply strategies based on mode
 * 4. Restore   — put protected regions back
 * 5. Validate  — check output quality
 * 6. Measure   — calculate token savings
 *
 * Why this order:
 * - Protect before strategize: strategies work on clean text
 * - Restore before validate: validator checks real content
 * - Validate before returning: never return broken output
 *
 * Strategy selection by mode:
 * SAFE:       whitespace + deduplication
 * BALANCED:   + verbosity + redundancy
 * AGGRESSIVE: + semantic (LLM-based)
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getTokenCounter } from "@/services/token/token-counter.service";
import { getCompressionAnalyzer } from "@/services/token/compression-analyzer.service";
import { getPromptAnalyzer } from "@/services/compression/prompt-analyzer";
import { getRegionProtector } from "@/services/compression/region-protector";
import { getCompressionValidator } from "@/services/compression/compression-validator";
import { WhitespaceStrategy } from "@/services/compression/strategies/whitespace.strategy";
import { DeduplicationStrategy } from "@/services/compression/strategies/deduplication.strategy";
import { VerbosityStrategy } from "@/services/compression/strategies/verbosity.strategy";
import { RedundancyStrategy } from "@/services/compression/strategies/redundancy.strategy";
import { SemanticCompressionStrategy } from "@/services/compression/strategies/semantic.strategy";
import {
  OptimizationMode,
  PromptType,
  type CompressionRequest,
  type CompressionResult,
  type ICompressionStrategy,
  type StageResult,
  type StrategyContext,
} from "@/types/compression";
import type { AIMessage } from "@/types/ai";

const log = createChildLogger({ module: "CompressionPipeline" });

// ─── Strategy Registry ────────────────────────────────────────────────────────

// All strategies in execution order
const ALL_STRATEGIES: ICompressionStrategy[] = [
  new WhitespaceStrategy(),
  new DeduplicationStrategy(),
  new VerbosityStrategy(),
  new RedundancyStrategy(),
  new SemanticCompressionStrategy(),
];

// Mode hierarchy: SAFE < BALANCED < AGGRESSIVE
const MODE_RANK: Record<OptimizationMode, number> = {
  [OptimizationMode.SAFE]: 0,
  [OptimizationMode.BALANCED]: 1,
  [OptimizationMode.AGGRESSIVE]: 2,
};

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export class CompressionPipeline {
  private readonly tokenCounter = getTokenCounter();
  private readonly compressionAnalyzer = getCompressionAnalyzer();
  private readonly promptAnalyzer = getPromptAnalyzer();
  private readonly regionProtector = getRegionProtector();
  private readonly validator = getCompressionValidator();

  /**
   * Run the full compression pipeline.
   */
  async compress(request: CompressionRequest): Promise<CompressionResult> {
    const startTime = Date.now();
    const originalText = this.normalizeInput(request.content);

    log.info(
      { mode: request.mode, model: request.model, requestId: request.requestId },
      "Starting compression pipeline",
    );

    // ── Stage 1: Analyze ────────────────────────────────────────────────────
    const analysis = this.promptAnalyzer.analyze(originalText);
    const promptType = request.promptType ?? analysis.type;

    // ── Stage 2: Protect ────────────────────────────────────────────────────
    const { text: protectedText, regions } = this.regionProtector.protect(
      originalText,
      [...analysis.protectedPatterns, ...(request.preservePatterns ?? [])],
    );

    // ── Stage 3: Apply Strategies ───────────────────────────────────────────
    const context: StrategyContext = {
      model: request.model,
      mode: request.mode,
      promptType,
      preservePatterns: request.preservePatterns ?? [],
      protectedRegions: regions,
    };

    const { text: compressedProtected, stageResults } = await this.applyStrategies(
      protectedText,
      context,
    );

    // ── Stage 4: Restore ────────────────────────────────────────────────────
    const compressedText = this.regionProtector.restore(compressedProtected, regions);

    // ── Stage 5: Validate ───────────────────────────────────────────────────
    const [originalCount, compressedCount] = await Promise.all([
      this.tokenCounter.countText(originalText, request.model),
      this.tokenCounter.countText(compressedText, request.model),
    ]);

    const compressionRatio =
      originalCount.tokenCount > 0
        ? compressedCount.tokenCount / originalCount.tokenCount
        : 1.0;

    const validation = this.validator.validate(originalText, compressedText, compressionRatio);

    // If validation says use original, return it
    const finalText =
      validation.recommendation === "use_original" ? originalText : compressedText;

    // ── Stage 6: Measure ────────────────────────────────────────────────────
    const compressionAnalysis = await this.compressionAnalyzer.analyzeCompression(
      originalText,
      finalText,
      request.model,
    );

    const targetAchieved = request.targetTokens
      ? compressedCount.tokenCount <= request.targetTokens
      : undefined;

    log.info(
      {
        mode: request.mode,
        promptType,
        originalTokens: originalCount.tokenCount,
        compressedTokens: compressedCount.tokenCount,
        ratio: compressionRatio.toFixed(2),
        latencyMs: Date.now() - startTime,
        requestId: request.requestId,
      },
      "Compression pipeline complete",
    );

    return {
      compressed: finalText,
      original: originalText,
      analysis: compressionAnalysis,
      mode: request.mode,
      promptType,
      stageResults,
      validation,
      targetAchieved,
      requestId: request.requestId,
    };
  }

  /**
   * Compress a messages array — compresses each message independently.
   * System messages get special treatment (more aggressive compression).
   */
  async compressMessages(
    messages: AIMessage[],
    request: Omit<CompressionRequest, "content">,
  ): Promise<{ messages: AIMessage[]; totalTokensSaved: number }> {
    let totalTokensSaved = 0;
    const compressedMessages: AIMessage[] = [];

    for (const message of messages) {
      // System messages: use one mode higher (they're usually verbose)
      const messageMode =
        message.role === "system"
          ? this.escalateMode(request.mode)
          : request.mode;

      const result = await this.compress({
        ...request,
        content: message.content,
        mode: messageMode,
      });

      compressedMessages.push({ ...message, content: result.compressed });
      totalTokensSaved += result.analysis.tokensSaved;
    }

    return { messages: compressedMessages, totalTokensSaved };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async applyStrategies(
    text: string,
    context: StrategyContext,
  ): Promise<{ text: string; stageResults: StageResult[] }> {
    const stageResults: StageResult[] = [];
    let current = text;

    // Filter strategies applicable to this mode and prompt type
    const activeStrategies = ALL_STRATEGIES.filter((strategy) => {
      const modeOk = MODE_RANK[context.mode] >= MODE_RANK[strategy.minimumMode];
      const typeOk =
        strategy.applicableTypes.length === 0 ||
        strategy.applicableTypes.includes(context.promptType);
      return modeOk && typeOk;
    });

    for (const strategy of activeStrategies) {
      const inputText = current;

      try {
        const result = await strategy.apply(current, context);
        current = result.text;

        stageResults.push({
          stage: strategy.name,
          inputText,
          outputText: current,
          tokensRemoved: result.tokensRemoved,
          transformationsApplied: result.transformationsApplied,
          skipped: false,
        });
      } catch (error) {
        log.warn({ strategy: strategy.name, err: error }, "Strategy failed — skipping");
        stageResults.push({
          stage: strategy.name,
          inputText,
          outputText: current,
          tokensRemoved: 0,
          transformationsApplied: [],
          skipped: true,
          skipReason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { text: current, stageResults };
  }

  private normalizeInput(content: string | AIMessage[]): string {
    if (typeof content === "string") return content;
    // For message arrays, compress the full concatenated content
    return content.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
  }

  private escalateMode(mode: OptimizationMode): OptimizationMode {
    if (mode === OptimizationMode.SAFE) return OptimizationMode.BALANCED;
    if (mode === OptimizationMode.BALANCED) return OptimizationMode.AGGRESSIVE;
    return OptimizationMode.AGGRESSIVE;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: CompressionPipeline | null = null;
export function getCompressionPipeline(): CompressionPipeline {
  instance ??= new CompressionPipeline();
  return instance;
}
