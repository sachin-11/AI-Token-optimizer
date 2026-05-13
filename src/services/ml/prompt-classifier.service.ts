// Embedding-based Prompt Type Classifier
// ML approach: k-Nearest-Neighbour with cosine similarity on text-embedding-3-small vectors.
// No training data needed — uses hardcoded gold-standard "anchor" examples per PromptType.
// At first call: embeds all anchors and caches vectors in Redis (24h TTL).
// Per request: embeds prompt, finds closest anchor, returns type + confidence.
// If max similarity < CONFIDENCE_THRESHOLD: returns null (caller falls back to regex).

import "server-only";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { getEmbeddingService } from "@/services/semantic/embedding.service";
import { PromptType } from "@/types/compression";

const log = createChildLogger({ module: "EmbeddingPromptClassifier" });

const ANCHOR_CACHE_KEY = "apo:v1:ml:anchors:v1";
const ANCHOR_CACHE_TTL = 86_400; // 24h — anchors are static, deterministic
const CONFIDENCE_THRESHOLD = 0.72; // below this score, defer to rule-based fallback

// Gold-standard anchor examples per PromptType.
// 4-5 diverse examples per type. These are embedded once and cached in Redis.
const TYPE_ANCHORS: Record<PromptType, string[]> = {
  [PromptType.CODING]: [
    "Write a TypeScript function to parse JSON and validate the schema using zod",
    "Debug this Python code and fix the recursion error in the fibonacci function",
    "Implement a React hook that fetches data with retry logic and caching",
    "Create a SQL query to find the top 10 users by total purchase amount in the last 30 days",
    "Explain how to implement a binary search tree with insert and delete operations in Java",
  ],
  [PromptType.AGENT]: [
    "You are an expert software architect. Your task is to review code and identify performance bottlenecks. Always explain your reasoning and never suggest untested solutions.",
    "You are a data analyst assistant. Your role is to help users interpret statistical results. Do not make predictions without sufficient data.",
    "Act as a customer support agent. Your goal is to resolve issues efficiently. You must escalate to human agents when the issue requires account access.",
    "You are a code review bot. Review the following pull request and identify bugs, security issues, and style violations. Do not approve if critical issues are found.",
  ],
  [PromptType.SYSTEM]: [
    "You are a helpful AI assistant that specializes in technical documentation. Respond clearly and concisely.",
    "You are an expert in machine learning. Provide accurate, evidence-based answers only.",
    "You are a coding assistant. Help users debug and write code. Be precise and brief.",
    "You are a senior software engineer. Answer questions about system design with real-world examples.",
  ],
  [PromptType.INSTRUCTION]: [
    "Please follow these steps to complete the task: 1. First gather requirements. 2. Create a design document. 3. Implement the solution. 4. Write tests. Do not skip any step.",
    "Complete the following tasks in order: review the PR, leave comments, approve or request changes. Always check for security vulnerabilities first.",
    "Follow this process exactly: validate input, sanitize data, process the request, store results, send confirmation.",
    "Execute these steps sequentially and verify each one before proceeding to the next. Report any failures immediately.",
  ],
  [PromptType.TECHNICAL]: [
    "Explain the differences between REST and GraphQL APIs in terms of performance, caching, and developer experience for a microservices architecture",
    "What are the trade-offs between PostgreSQL with pgvector versus a dedicated vector database for semantic search at scale?",
    "Describe the CAP theorem and how it applies to distributed database design in a high-availability system",
    "Compare Kubernetes horizontal pod autoscaling versus vertical pod autoscaling for a stateful workload",
  ],
  [PromptType.CONVERSATIONAL]: [
    "Can you help me understand what machine learning is in simple terms?",
    "What is the best way to learn programming as a complete beginner?",
    "I am confused about how APIs work, can you explain it simply?",
    "Tell me about the history of the internet in a few paragraphs",
    "What should I know before starting my first software engineering job?",
  ],
  [PromptType.GENERAL]: [
    "Summarize the key points from this document and highlight the most important findings for a business audience",
    "Review this proposal and provide feedback on both the strengths and areas for improvement",
    "Help me draft a professional email responding to a job offer with some negotiation on salary and start date",
    "Analyze the pros and cons of these two approaches and recommend the best path forward with reasoning",
  ],
};

// Cached anchor vectors loaded from Redis or recomputed
type AnchorCache = Record<PromptType, number[][]>;

export interface ClassificationResult {
  type: PromptType;
  confidence: number;        // 0-1, cosine similarity to closest anchor
  source: "ml_embedding";
  topMatches: Array<{ type: PromptType; score: number }>;
}

export class EmbeddingPromptClassifier {
  private readonly embedder = getEmbeddingService();
  // In-memory anchor cache (avoids Redis round-trip within same process lifetime)
  private memCache: AnchorCache | null = null;

  /**
   * Classify a prompt using embedding similarity.
   * Returns null if confidence is below threshold — caller should use rule-based fallback.
   */
  async classify(text: string): Promise<ClassificationResult | null> {
    try {
      const [promptEmbedding, anchors] = await Promise.all([
        this.embedder.embed(text),
        this.loadAnchors(),
      ]);

      // Score each type: average similarity across all anchors of that type
      const typeScores: Array<{ type: PromptType; score: number }> = [];

      for (const [typeStr, anchorVectors] of Object.entries(anchors)) {
        const type = typeStr as PromptType;
        const scores = anchorVectors.map((anchorVec) =>
          this.embedder.cosineSimilarity(promptEmbedding.vector, anchorVec)
        );
        // Use max (best anchor match) rather than mean — more discriminative
        const maxScore = Math.max(...scores);
        typeScores.push({ type, score: Number(maxScore.toFixed(4)) });
      }

      // Sort descending by score
      typeScores.sort((a, b) => b.score - a.score);

      const best = typeScores[0];
      if (!best || best.score < CONFIDENCE_THRESHOLD) {
        log.debug({ bestScore: best?.score, threshold: CONFIDENCE_THRESHOLD }, "ML classifier confidence too low — deferring to rule-based");
        return null;
      }

      log.debug({ type: best.type, confidence: best.score }, "ML classifier result");
      return {
        type: best.type,
        confidence: best.score,
        source: "ml_embedding",
        topMatches: typeScores.slice(0, 3),
      };
    } catch (error) {
      log.warn({ err: error }, "ML classifier failed — falling back to rule-based");
      return null;
    }
  }

  /**
   * Pre-warm anchor embeddings at startup so first request is fast.
   */
  async warmUp(): Promise<void> {
    await this.loadAnchors();
    log.info("Prompt classifier anchors warmed");
  }

  // Load anchor embeddings from in-memory cache → Redis → compute fresh
  private async loadAnchors(): Promise<AnchorCache> {
    if (this.memCache) return this.memCache;

    // Try Redis
    try {
      const raw = await redis.get(ANCHOR_CACHE_KEY);
      if (raw) {
        this.memCache = JSON.parse(raw) as AnchorCache;
        return this.memCache;
      }
    } catch {
      // Redis miss is non-fatal
    }

    // Compute fresh — embed all anchors in parallel batches
    log.info("Computing anchor embeddings for prompt classifier...");
    const result: Partial<AnchorCache> = {};

    await Promise.all(
      Object.entries(TYPE_ANCHORS).map(async ([typeStr, examples]) => {
        const type = typeStr as PromptType;
        const vectors = await Promise.all(
          examples.map((ex) => this.embedder.embed(ex).then((r) => r.vector))
        );
        result[type] = vectors;
      })
    );

    this.memCache = result as AnchorCache;

    // Cache in Redis asynchronously
    void redis
      .setex(ANCHOR_CACHE_KEY, ANCHOR_CACHE_TTL, JSON.stringify(this.memCache))
      .catch(() => { /* non-fatal */ });

    log.info({ types: Object.keys(result).length }, "Anchor embeddings computed and cached");
    return this.memCache;
  }
}

let instance: EmbeddingPromptClassifier | null = null;
export function getEmbeddingPromptClassifier(): EmbeddingPromptClassifier {
  instance ??= new EmbeddingPromptClassifier();
  return instance;
}
