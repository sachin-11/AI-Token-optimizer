/**
 * Semantic Validation Type Definitions
 */

// ─── Embedding ────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  vector: number[];          // 1536-dim for text-embedding-3-small
  model: string;
  tokenCount: number;
  durationMs: number;
}

// ─── Similarity ───────────────────────────────────────────────────────────────

export interface SimilarityResult {
  cosineSimilarity: number;   // -1 to 1 (1 = identical)
  normalizedScore: number;    // 0 to 1 (easier to reason about)
  interpretation: SimilarityInterpretation;
}

export type SimilarityInterpretation =
  | "identical"       // > 0.98
  | "very_similar"    // > 0.92
  | "similar"         // > 0.85
  | "somewhat_similar"// > 0.75
  | "different"       // > 0.60
  | "very_different"; // <= 0.60

// ─── Semantic Validation ──────────────────────────────────────────────────────

export interface SemanticValidationRequest {
  original: string;
  optimized: string;
  /** Minimum acceptable similarity score (0-1) */
  threshold?: number;
  requestId?: string;
}

export interface SemanticValidationResult {
  requestId?: string;

  // Core scores
  embeddingSimilarity: SimilarityResult;
  meaningPreservationScore: number;   // 0-1 composite
  qualityScore: number;               // 0-100 for UI display
  confidence: number;                 // 0-1 how confident we are

  // Decision
  isValid: boolean;
  recommendation: "accept" | "reject" | "review";

  // Detail
  issues: SemanticIssue[];
  strengths: string[];

  // Performance
  durationMs: number;
}

export interface SemanticIssue {
  severity: "critical" | "warning" | "info";
  message: string;
}

// ─── Cache Entry ──────────────────────────────────────────────────────────────

export interface EmbeddingCacheEntry {
  id: string;
  promptHash: string;
  vector: number[];
  model: string;
  tokenCount: number;
  hitCount: number;
  expiresAt: Date;
}

// ─── pgvector Search ──────────────────────────────────────────────────────────

export interface VectorSearchResult {
  id: string;
  promptHash: string;
  response: string;
  similarity: number;
  tokenCount: number;
}
