// Metrics registry
export { registry } from "./metrics";

// Distributed tracer
export { tracer, Tracer } from "./tracer";
export type { Span, SpanContext, SpanAttributes, SpanStatus } from "./tracer";

// AI-specific metrics
export {
  recordAIRequest,
  recordAIResponse,
  recordOptimizationResult,
  recordHttpRequest,
  updateCacheHitRate,
} from "./ai-metrics";

// Request logging HOF
export { withRequestLogging, extractRequestContext } from "./request-logger";
export type { RequestContext } from "./request-logger";

// Workflow tracing
export { getWorkflowTracer, WorkflowTracer, createAgentTimer } from "./workflow-tracer";

// Health checks
export { getHealthReport } from "./health-checker";
export type { HealthReport, HealthStatus, ComponentHealth } from "./health-checker";
