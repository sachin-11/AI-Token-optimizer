/**
 * Token Counter Service
 *
 * Core tokenization logic. Handles:
 * - Exact counting via tiktoken for OpenAI models
 * - Statistical estimation for Claude and Gemini
 * - Chat message format overhead (role tokens, separators)
 * - Batch counting with concurrency control
 *
 * Why estimation for Claude/Gemini:
 * - Anthropic and Google don't publish their tokenizers
 * - Claude uses a similar BPE tokenizer — empirically ~1.1x GPT token count
 * - Gemini uses SentencePiece — empirically ~1.15x GPT token count
 * - These ratios are calibrated from real API usage data
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { createConcurrencyLimit } from "@/utils/async";
import { encodingRegistry } from "@/services/token/encoding-registry";
import { getEncoder } from "@/services/token/tiktoken-cache";
import { modelRegistry } from "@/services/ai/model-registry";
import { AIProviderName, type AIMessage, type AIModel } from "@/types/ai";
import type {
  MessageTokenBreakdown,
  MessageTokenCountResult,
  TiktokenEncoding,
  TokenCountResult,
} from "@/types/tokenizer";

const log = createChildLogger({ module: "TokenCounterService" });

// ─── Estimation Ratios ────────────────────────────────────────────────────────

/**
 * Empirical multipliers relative to GPT cl100k_base token counts.
 * Calibrated from production usage across thousands of requests.
 */
const ESTIMATION_RATIOS: Record<AIProviderName, number> = {
  [AIProviderName.OPENAI]: 1.0,     // Exact via tiktoken
  [AIProviderName.ANTHROPIC]: 1.1,  // Claude tokenizer is slightly more efficient
  [AIProviderName.GEMINI]: 1.15,    // SentencePiece tends to produce more tokens
};

/**
 * Chat format overhead per message (role + separators).
 * OpenAI's chat format adds tokens beyond the raw content.
 * Source: https://platform.openai.com/docs/guides/text-generation/managing-tokens
 */
const CHAT_FORMAT_OVERHEAD = {
  perMessage: 4,   // Every message: <|start|>{role}\n{content}<|end|>\n
  perReply: 3,     // Every reply is primed with <|start|>assistant<|message|>
  perRequest: 3,   // Base overhead per API call
} as const;

// ─── Token Counter Service ────────────────────────────────────────────────────

export class TokenCounterService {
  // Limit concurrent encoder operations to avoid memory pressure
  private readonly concurrencyLimit = createConcurrencyLimit(10);

  /**
   * Count tokens in a plain text string for a specific model.
   */
  async countText(text: string, model: AIModel): Promise<TokenCountResult> {
    const encoding = encodingRegistry.getEncoding(model);

    if (encoding) {
      return this.countExact(text, model, encoding);
    }

    return this.estimateForProvider(text, model);
  }

  /**
   * Count tokens in a chat messages array, including format overhead.
   * This matches what OpenAI actually charges for chat completions.
   */
  async countMessages(
    messages: AIMessage[],
    model: AIModel,
  ): Promise<MessageTokenCountResult> {
    const encoding = encodingRegistry.getEncoding(model);
    const breakdown: MessageTokenBreakdown[] = [];
    let totalContentTokens = 0;

    for (const message of messages) {
      let contentTokens: number;

      if (encoding) {
        const result = await this.countExact(message.content, model, encoding);
        contentTokens = result.tokenCount;
      } else {
        const result = await this.estimateForProvider(message.content, model);
        contentTokens = result.tokenCount;
      }

      const overheadTokens = CHAT_FORMAT_OVERHEAD.perMessage;
      breakdown.push({
        role: message.role,
        contentTokens,
        overheadTokens,
        totalTokens: contentTokens + overheadTokens,
      });

      totalContentTokens += contentTokens + overheadTokens;
    }

    // Add base request overhead
    const chatFormatOverhead =
      CHAT_FORMAT_OVERHEAD.perRequest + CHAT_FORMAT_OVERHEAD.perReply;
    const totalTokens = totalContentTokens + chatFormatOverhead;

    return {
      tokenCount: totalTokens,
      model,
      encoding: encoding ?? "estimated",
      isEstimate: !encoding,
      messageBreakdown: breakdown,
      chatFormatOverhead,
    };
  }

  /**
   * Fast synchronous estimation using character-based heuristics.
   * Use when you need a quick estimate without async overhead.
   *
   * Rule of thumb: ~4 chars per token for English text (GPT tokenizer average).
   * This is less accurate than tiktoken but ~100x faster.
   */
  estimateSync(text: string, model: AIModel): TokenCountResult {
    const info = modelRegistry.find(model);
    const ratio = info ? ESTIMATION_RATIOS[info.provider] : 1.0;

    // 4 chars/token is the empirical average for English
    // Adjust for code (~3 chars/token) and other languages (~2-3 chars/token)
    const charsPerToken = this.detectContentType(text) === "code" ? 3 : 4;
    const baseEstimate = Math.ceil(text.length / charsPerToken);
    const tokenCount = Math.ceil(baseEstimate * ratio);

    return {
      tokenCount,
      model,
      encoding: "estimated",
      isEstimate: true,
    };
  }

  /**
   * Count tokens for multiple texts in parallel with concurrency control.
   */
  async countBatch(
    texts: string[],
    model: AIModel,
  ): Promise<TokenCountResult[]> {
    return Promise.all(
      texts.map((text) =>
        this.concurrencyLimit(() => this.countText(text, model)),
      ),
    );
  }

  /**
   * Get the token count of a string after encoding to a specific format.
   * Useful for comparing token efficiency across different phrasings.
   */
  async compareTokenCounts(
    texts: string[],
    model: AIModel,
  ): Promise<{ text: string; tokenCount: number; rank: number }[]> {
    const results = await this.countBatch(texts, model);

    return results
      .map((result, i) => ({
        text: texts[i] ?? "",
        tokenCount: result.tokenCount,
        rank: 0,
      }))
      .sort((a, b) => a.tokenCount - b.tokenCount)
      .map((item, i) => ({ ...item, rank: i + 1 }));
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  private async countExact(
    text: string,
    model: AIModel,
    encoding: TiktokenEncoding,
  ): Promise<TokenCountResult> {
    return this.concurrencyLimit(async () => {
      try {
        const encoder = await getEncoder(encoding);
        const tokens = encoder.encode(text);
        return {
          tokenCount: tokens.length,
          model,
          encoding,
          isEstimate: false,
        };
      } catch (error) {
        log.warn({ model, encoding, err: error }, "Exact count failed, falling back to estimate");
        return this.estimateForProvider(text, model);
      }
    });
  }

  private async estimateForProvider(
    text: string,
    model: AIModel,
  ): Promise<TokenCountResult> {
    // Get base count using cl100k_base (most common encoding)
    let baseTokenCount: number;

    try {
      const encoder = await getEncoder("cl100k_base");
      baseTokenCount = encoder.encode(text).length;
    } catch {
      // If tiktoken fails entirely, use char-based estimation
      baseTokenCount = Math.ceil(text.length / 4);
    }

    const info = modelRegistry.find(model);
    const ratio = info ? ESTIMATION_RATIOS[info.provider] : 1.0;
    const tokenCount = Math.ceil(baseTokenCount * ratio);

    return {
      tokenCount,
      model,
      encoding: "estimated",
      isEstimate: true,
    };
  }

  private detectContentType(text: string): "code" | "prose" {
    // Simple heuristic: code has more special chars and shorter lines
    const specialCharRatio =
      (text.match(/[{}()[\];=><]/g)?.length ?? 0) / text.length;
    return specialCharRatio > 0.05 ? "code" : "prose";
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: TokenCounterService | null = null;

export function getTokenCounter(): TokenCounterService {
  instance ??= new TokenCounterService();
  return instance;
}
