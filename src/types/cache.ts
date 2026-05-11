/**
 * Cache Layer Type Definitions
 *
 * Three cache tiers, each with different key strategies and TTLs:
 *
 * 1. Hash Cache    — exact prompt hash → response (fastest, cheapest)
 * 2. Semantic Cache — embedding similarity → response (fuzzy match)
 * 3. Embedding Cache — text → vector (avoids re-embedding same text)
 */

import type { AICompletionResponse, AIModel } from "@/types/ai";

// ─── Cache Tiers ──────────────────────────────────────────────────────────────

export enum CacheTier {
  HASH      = "hash",      // Exact match — O(1) lookup
  SEMANTIC  = "semantic",  // Similarity match — O(n) vector search
  EMBEDDING = "embedding", // Vector storage — avoids re-embedding
}

// ─── Cache Entry ──────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  data: T;
  tier: CacheTier;
  model: AIModel;
  promptHash: string;
  hitCount: number;
  createdAt: string;
  expiresAt: string;
  /** Similarity score — only set for semantic cache hits */
  similarity?: number;
}

// ─── Cache Result ─────────────────────────────────────────────────────────────

export interface CacheHit<T = unknown> {
  hit: true;
  entry: CacheEntry<T>;
  tier: CacheTier;
  latencyMs: number;
}

export interface CacheMiss {
  hit: false;
  tier: null;
  latencyMs: number;
}

export type CacheResult<T = unknown> = CacheHit<T> | CacheMiss;

// ─── Cache Options ────────────────────────────────────────────────────────────

export interface CacheSetOptions {
  ttlSeconds?: number;
  /** Store in semantic cache (pgvector) in addition to Redis */
  storeInSemanticCache?: boolean;
}

export interface CacheGetOptions {
  /** Skip semantic similarity search (faster, exact only) */
  skipSemantic?: boolean;
  /** Minimum similarity threshold for semantic hits */
  similarityThreshold?: number;
}

// ─── TTL Config ───────────────────────────────────────────────────────────────

export interface TtlConfig {
  /** Exact hash cache TTL */
  hashTtlSeconds: number;
  /** Embedding vector cache TTL */
  embeddingTtlSeconds: number;
  /** Semantic cache TTL (pgvector) */
  semanticTtlSeconds: number;
  /** Response metadata TTL */
  metaTtlSeconds: number;
}

// ─── Cache Stats ──────────────────────────────────────────────────────────────

export interface CacheStats {
  hashHits: number;
  semanticHits: number;
  misses: number;
  totalRequests: number;
  hitRate: number;
  avgLatencyMs: number;
  estimatedSavingsUsd: number;
}

// ─── Invalidation ─────────────────────────────────────────────────────────────

export interface InvalidationResult {
  keysDeleted: number;
  tier: CacheTier | "all";
}
