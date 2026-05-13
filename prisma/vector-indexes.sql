-- =============================================================================
-- pgvector HNSW Index Setup
-- =============================================================================
-- Run ONCE after `prisma db push` or your first migration.
--
--   psql $DATABASE_URL -f prisma/vector-indexes.sql
--
-- Why HNSW over IVFFlat:
-- - No training step needed (IVFFlat requires VACUUM ANALYZE first)
-- - Better recall at higher search speeds for our dataset size
-- - INSERT performance is acceptable for our write volume
--
-- Tuning parameters used:
--   m = 16             — connections per node (higher = better recall, more memory)
--   ef_construction = 64 — build-time search width (higher = better quality index)
--
-- At query time, SET hnsw.ef_search = 100 for even better recall if needed.
-- The default (40) is fine for similarity threshold >= 0.92.
-- =============================================================================

-- ─── semantic_cache (AI completion response cache) ────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_cache_embedding_hnsw_idx
  ON semantic_cache
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── workflow_semantic_cache (full WorkflowResult cache) ──────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_semantic_cache_embedding_hnsw_idx
  ON workflow_semantic_cache
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Composite B-tree index for the model+mode pre-filter in findSimilar()
-- pgvector uses this to narrow the candidate set before the ANN scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_semantic_cache_model_mode_idx
  ON workflow_semantic_cache (model, mode);

-- ─── Verify ───────────────────────────────────────────────────────────────────

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('semantic_cache', 'workflow_semantic_cache')
  AND indexname LIKE '%hnsw%'
ORDER BY tablename, indexname;
