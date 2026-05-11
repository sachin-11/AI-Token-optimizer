/**
 * Embedding Service
 *
 * Generates vector embeddings via OpenAI's text-embedding-3-small.
 * Why text-embedding-3-small over ada-002:
 * - 5x cheaper, same 1536 dimensions, better quality
 * - Cosine similarity works well for semantic comparison
 *
 * Caches embeddings in Redis (short TTL) to avoid re-embedding
 * the same text multiple times in one request lifecycle.
 */

import "server-only";

import crypto from "crypto";
import OpenAI from "openai";

import { env } from "@/config/env";
import { createChildLogger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import type { EmbeddingResult } from "@/types/semantic";

const log = createChildLogger({ module: "EmbeddingService" });

const EMBEDDING_MODEL = "text-embedding-3-small";
const CACHE_TTL_SECONDS = 3600; // 1 hour — embeddings are deterministic
const CACHE_PREFIX = "emb:";

export class EmbeddingService {
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  /**
   * Generate embedding for a single text.
   * Returns cached result if available.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const hash = this.hashText(text);
    const cacheKey = `${CACHE_PREFIX}${hash}`;

    // Check Redis cache first
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    const start = Date.now();

    const response = await this.client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8191), // API limit
      encoding_format: "float",
    });

    const result: EmbeddingResult = {
      vector: response.data[0]!.embedding,
      model: EMBEDDING_MODEL,
      tokenCount: response.usage.prompt_tokens,
      durationMs: Date.now() - start,
    };

    // Cache asynchronously — don't block the response
    void this.saveToCache(cacheKey, result);

    log.debug({ tokenCount: result.tokenCount, durationMs: result.durationMs }, "Embedding generated");
    return result;
  }

  /**
   * Generate embeddings for two texts in parallel.
   */
  async embedPair(text1: string, text2: string): Promise<[EmbeddingResult, EmbeddingResult]> {
    return Promise.all([this.embed(text1), this.embed(text2)]);
  }

  /**
   * Compute cosine similarity between two vectors.
   * Returns value between -1 and 1 (1 = identical direction).
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) throw new Error("Vector dimension mismatch");

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  hashText(text: string): string {
    return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex").slice(0, 16);
  }

  // ─── Cache ────────────────────────────────────────────────────────────────

  private async getFromCache(key: string): Promise<EmbeddingResult | null> {
    try {
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as EmbeddingResult;
    } catch {
      return null;
    }
  }

  private async saveToCache(key: string, result: EmbeddingResult): Promise<void> {
    try {
      await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(result));
    } catch {
      // Cache failure is non-fatal
    }
  }
}

let instance: EmbeddingService | null = null;
export function getEmbeddingService(): EmbeddingService {
  instance ??= new EmbeddingService();
  return instance;
}
