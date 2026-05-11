/**
 * Similarity Service
 *
 * Computes semantic similarity between two texts using embeddings.
 * Interprets raw cosine similarity into human-readable categories
 * and normalized 0-1 scores.
 *
 * Threshold calibration (empirical, based on OpenAI text-embedding-3-small):
 * - Paraphrases of same sentence: ~0.95-0.99
 * - Same meaning, different wording: ~0.88-0.95
 * - Related topics: ~0.75-0.88
 * - Different topics: < 0.75
 */

import "server-only";

import { getEmbeddingService } from "@/services/semantic/embedding.service";
import type { SimilarityInterpretation, SimilarityResult } from "@/types/semantic";

// ─── Thresholds ───────────────────────────────────────────────────────────────

const THRESHOLDS: Array<{ min: number; label: SimilarityInterpretation }> = [
  { min: 0.98, label: "identical" },
  { min: 0.92, label: "very_similar" },
  { min: 0.85, label: "similar" },
  { min: 0.75, label: "somewhat_similar" },
  { min: 0.60, label: "different" },
  { min: -1.0, label: "very_different" },
];

export class SimilarityService {
  private readonly embedder = getEmbeddingService();

  /**
   * Compute semantic similarity between two texts.
   */
  async compare(text1: string, text2: string): Promise<SimilarityResult> {
    const [emb1, emb2] = await this.embedder.embedPair(text1, text2);

    const cosineSimilarity = this.embedder.cosineSimilarity(emb1.vector, emb2.vector);

    // Normalize from [-1,1] to [0,1]
    const normalizedScore = (cosineSimilarity + 1) / 2;

    return {
      cosineSimilarity: Number(cosineSimilarity.toFixed(4)),
      normalizedScore: Number(normalizedScore.toFixed(4)),
      interpretation: this.interpret(cosineSimilarity),
    };
  }

  /**
   * Quick similarity check — returns just the score.
   */
  async score(text1: string, text2: string): Promise<number> {
    const result = await this.compare(text1, text2);
    return result.cosineSimilarity;
  }

  interpret(cosine: number): SimilarityInterpretation {
    return THRESHOLDS.find((t) => cosine >= t.min)?.label ?? "very_different";
  }

  /**
   * Check if similarity meets a minimum threshold.
   */
  meetsThreshold(similarity: SimilarityResult, threshold: number): boolean {
    return similarity.cosineSimilarity >= threshold;
  }
}

let instance: SimilarityService | null = null;
export function getSimilarityService(): SimilarityService {
  instance ??= new SimilarityService();
  return instance;
}
