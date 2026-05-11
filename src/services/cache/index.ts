/**
 * Cache Layer — Public API
 */

// Main service (use this everywhere)
export { getCacheService, CacheService } from "./cache.service";

// Individual tiers (for direct access)
export { getHashCache, HashCacheService } from "./hash-cache.service";
export { getSemanticCache, SemanticCacheService } from "./semantic-cache.service";
export { getCacheStats, CacheStatsService } from "./cache-stats.service";

// Middleware
export { withAICache, withActionCache, valueCache } from "./cache.middleware";

// Utilities
export { CacheKeyFactory } from "./cache-key.factory";
export { TtlManager } from "./ttl-manager";
