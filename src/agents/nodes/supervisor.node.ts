/**
 * Supervisor Agent Node
 *
 * The orchestrator. Makes routing decisions based on current state.
 * Called after every other agent completes.
 *
 * Supervisor Pattern:
 * - Supervisor is the only node that decides what happens next
 * - Other agents are "workers" — they execute and report back
 * - This centralizes routing logic in one place (easier to reason about)
 *
 * Decision tree:
 * 1. If status is FAILED → FAIL
 * 2. If no token analysis → ANALYZE_TOKENS
 * 3. If no compression → COMPRESS (or skip if not needed)
 * 4. If compression failed and retries remain → RETRY_COMPRESSION
 * 5. If no validation → VALIDATE
 * 6. If validation says retry → RETRY_COMPRESSION
 * 7. If no review → REVIEW
 * 8. If review complete → COMPLETE
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { AgentName, SupervisorDecision, WorkflowStatus } from "@/types/agent";
import {
  createStreamEvent,
  createTraceEntry,
  type WorkflowState,
} from "@/agents/state/workflow-state";

const log = createChildLogger({ module: "SupervisorNode" });

export async function supervisorNode(
  state: WorkflowState,
): Promise<Partial<WorkflowState>> {
  const startedAt = new Date();

  // ── Decision Logic ─────────────────────────────────────────────────────────

  const decision = makeDecision(state);

  log.info(
    { requestId: state.requestId, decision, currentAgent: state.currentAgent },
    "Supervisor decision",
  );

  const trace = createTraceEntry(
    AgentName.SUPERVISOR,
    startedAt,
    true,
    `After: ${state.currentAgent ?? "start"}`,
    `Decision: ${decision}`,
  );

  const event = createStreamEvent(
    "supervisor_decision",
    `Supervisor → ${decision}`,
    { agent: AgentName.SUPERVISOR, decision },
  );

  // ── Determine final prompt if completing ───────────────────────────────────

  let finalPrompt: string | null = state.finalPrompt;
  let status = state.status;

  if (decision === SupervisorDecision.COMPLETE) {
    finalPrompt = resolveFinalPrompt(state);
    status = WorkflowStatus.COMPLETED;
  } else if (decision === SupervisorDecision.FAIL) {
    finalPrompt = state.originalPrompt; // Fallback to original on failure
    status = WorkflowStatus.FAILED;
  }

  return {
    currentAgent: AgentName.SUPERVISOR,
    supervisorDecision: decision,
    finalPrompt,
    status,
    agentTrace: [trace],
    streamEvents: [event],
  };
}

// ─── Decision Logic ───────────────────────────────────────────────────────────

function makeDecision(state: WorkflowState): SupervisorDecision {
  // Hard failure — stop
  if (state.status === WorkflowStatus.FAILED) {
    return SupervisorDecision.FAIL;
  }

  // Step 1: Token analysis not done yet
  if (!state.tokenAnalysis) {
    return SupervisorDecision.ANALYZE_TOKENS;
  }

  // Step 2: Compression not needed (tiny prompt)
  if (!state.tokenAnalysis.compressionNeeded && !state.compressionResult) {
    return SupervisorDecision.COMPLETE;
  }

  // Step 3: Compression not done yet
  if (!state.compressionResult) {
    return SupervisorDecision.COMPRESS;
  }

  // Step 4: Compression failed — retry if budget allows
  const compressionErrors = state.errors.filter(
    (e) => e.agent === AgentName.COMPRESSION && e.retryable,
  );
  if (compressionErrors.length > 0 && state.retryCount <= state.maxRetries) {
    return SupervisorDecision.RETRY_COMPRESSION;
  }

  // Step 5: Compression failed and no retries left — complete with original
  if (compressionErrors.length > 0 && state.retryCount > state.maxRetries) {
    return SupervisorDecision.COMPLETE;
  }

  // Step 6: Validation not done yet
  if (!state.validationOutput) {
    return SupervisorDecision.VALIDATE;
  }

  // Step 7: Validator says retry
  if (
    state.validationOutput.recommendation === "retry_with_safe_mode" &&
    state.retryCount < state.maxRetries
  ) {
    return SupervisorDecision.RETRY_COMPRESSION;
  }

  // Step 8: Review not done yet
  if (!state.reviewOutput) {
    return SupervisorDecision.REVIEW;
  }

  // Step 9: Reviewer says retry
  if (
    state.reviewOutput.finalDecision === "retry" &&
    state.retryCount < state.maxRetries
  ) {
    return SupervisorDecision.RETRY_COMPRESSION;
  }

  // All steps complete
  return SupervisorDecision.COMPLETE;
}

// ─── Final Prompt Resolution ──────────────────────────────────────────────────

function resolveFinalPrompt(state: WorkflowState): string {
  // No compression was done
  if (!state.compressionResult) return state.originalPrompt;

  // Reviewer decided to use original
  if (state.reviewOutput?.finalDecision === "use_original") {
    return state.originalPrompt;
  }

  // Validation says reject
  if (state.validationOutput?.recommendation === "reject") {
    return state.originalPrompt;
  }

  // Use compressed
  return state.compressionResult.compressed;
}
