/**
 * Compression Services — Public API
 */

// Main service (use this in route handlers and server actions)
export { getCompressionService, CompressionService } from "./compression.service";

// Pipeline (use for advanced orchestration)
export { getCompressionPipeline, CompressionPipeline } from "./compression-pipeline";

// Analyzer (use for prompt type detection)
export { getPromptAnalyzer, PromptAnalyzer } from "./prompt-analyzer";

// Validator (use for standalone validation)
export { getCompressionValidator, CompressionValidator } from "./compression-validator";

// Region protector (use for custom pipelines)
export { getRegionProtector, RegionProtector } from "./region-protector";

// Individual strategies (use for custom pipelines)
export { WhitespaceStrategy } from "./strategies/whitespace.strategy";
export { DeduplicationStrategy } from "./strategies/deduplication.strategy";
export { VerbosityStrategy } from "./strategies/verbosity.strategy";
export { RedundancyStrategy } from "./strategies/redundancy.strategy";
export { SemanticCompressionStrategy } from "./strategies/semantic.strategy";

// Types
export type { PromptAnalysis, PromptCharacteristics } from "./prompt-analyzer";
