/**
 * Optimization Workflow Graph
 *
 * Defines the LangGraph state machine for prompt optimization.
 *
 * Graph topology:
 *
 *   START
 *     │
 *     ▼
 *  supervisor ──────────────────────────────────────────────┐
 *     │                                                      │
 *     ├─ ANALYZE_TOKENS ──► token_analyzer ──► supervisor   │
 *     │                                                      │
 *     ├─ COMPRESS ──────────► compression ──► supervisor    │
 *     │                                                      │
 *     ├─ RETRY_COMPRESSION ─► compression ──► supervisor    │
 *     │                                                      │
 *     ├─ VALIDATE ──────────► semantic_validator ──► supervisor
 *     │                                                      │
 *     ├─ REVIEW ────────────► reviewer ──► supervisor       │
 *     │                                                      │
 *     ├─ COMPLETE ──────────────────────────────────────────► END
 *     │
 *     └─ FAIL ──────────────────────────────────────────────► END
 *
 * Why supervisor pattern:
 * - Single routing authority — no distributed decision making
 * - Easy to add new agents (just add a new decision + edge)
 * - Full audit trail — supervisor logs every decision
 * - Retry logic is centralized in supervisor, not scattered across nodes
 */

import "server-only";

import { StateGraph, END, START } from "@langchain/langgraph";

import { supervisorNode } from "@/agents/nodes/supervisor.node";
import { tokenAnalyzerNode } from "@/agents/nodes/token-analyzer.node";
import { compressionNode } from "@/agents/nodes/compression.node";
import { semanticValidatorNode } from "@/agents/nodes/semantic-validator.node";
import { reviewerNode } from "@/agents/nodes/reviewer.node";
import { SupervisorDecision } from "@/types/agent";
import {
  WorkflowStateAnnotation,
  type WorkflowState,
} from "@/agents/state/workflow-state";

// ─── Node Names ───────────────────────────────────────────────────────────────

export const NODE = {
  SUPERVISOR:         "supervisor",
  TOKEN_ANALYZER:     "token_analyzer",
  COMPRESSION:        "compression",
  SEMANTIC_VALIDATOR: "semantic_validator",
  REVIEWER:           "reviewer",
} as const;

// ─── Graph Builder ────────────────────────────────────────────────────────────

function buildOptimizationGraph() {
  const graph = new StateGraph(WorkflowStateAnnotation);

  // ── Register Nodes ─────────────────────────────────────────────────────────
  graph
    .addNode(NODE.SUPERVISOR, supervisorNode)
    .addNode(NODE.TOKEN_ANALYZER, tokenAnalyzerNode)
    .addNode(NODE.COMPRESSION, compressionNode)
    .addNode(NODE.SEMANTIC_VALIDATOR, semanticValidatorNode)
    .addNode(NODE.REVIEWER, reviewerNode);

  // ── Entry Point ────────────────────────────────────────────────────────────
  graph.addEdge(START, NODE.SUPERVISOR);

  // ── Supervisor Conditional Routing ────────────────────────────────────────
  // The supervisor's decision field drives all routing.
  graph.addConditionalEdges(
    NODE.SUPERVISOR,
    supervisorRouter,
    {
      [SupervisorDecision.ANALYZE_TOKENS]:    NODE.TOKEN_ANALYZER,
      [SupervisorDecision.COMPRESS]:          NODE.COMPRESSION,
      [SupervisorDecision.RETRY_COMPRESSION]: NODE.COMPRESSION,
      [SupervisorDecision.VALIDATE]:          NODE.SEMANTIC_VALIDATOR,
      [SupervisorDecision.REVIEW]:            NODE.REVIEWER,
      [SupervisorDecision.COMPLETE]:          END,
      [SupervisorDecision.FAIL]:              END,
    },
  );

  // ── All worker nodes return to supervisor ──────────────────────────────────
  graph.addEdge(NODE.TOKEN_ANALYZER, NODE.SUPERVISOR);
  graph.addEdge(NODE.COMPRESSION, NODE.SUPERVISOR);
  graph.addEdge(NODE.SEMANTIC_VALIDATOR, NODE.SUPERVISOR);
  graph.addEdge(NODE.REVIEWER, NODE.SUPERVISOR);

  return graph.compile();
}

// ─── Router Function ──────────────────────────────────────────────────────────

/**
 * Extracts the supervisor's decision from state for conditional routing.
 * LangGraph calls this after the supervisor node to determine the next node.
 */
function supervisorRouter(state: WorkflowState): SupervisorDecision {
  return state.supervisorDecision ?? SupervisorDecision.FAIL;
}

// ─── Compiled Graph Singleton ─────────────────────────────────────────────────

let compiledGraph: ReturnType<typeof buildOptimizationGraph> | null = null;

export function getOptimizationGraph() {
  compiledGraph ??= buildOptimizationGraph();
  return compiledGraph;
}

/**
 * Graph visualization data for the UI.
 * Returns a simple adjacency list that can be rendered as a flowchart.
 */
export function getGraphVisualization() {
  return {
    nodes: [
      { id: NODE.SUPERVISOR,         label: "Supervisor",          type: "orchestrator" },
      { id: NODE.TOKEN_ANALYZER,     label: "Token Analyzer",      type: "worker" },
      { id: NODE.COMPRESSION,        label: "Compression Agent",   type: "worker" },
      { id: NODE.SEMANTIC_VALIDATOR, label: "Semantic Validator",  type: "worker" },
      { id: NODE.REVIEWER,           label: "Reviewer",            type: "worker" },
    ],
    edges: [
      { from: "START",               to: NODE.SUPERVISOR,          label: "start" },
      { from: NODE.SUPERVISOR,       to: NODE.TOKEN_ANALYZER,      label: SupervisorDecision.ANALYZE_TOKENS },
      { from: NODE.SUPERVISOR,       to: NODE.COMPRESSION,         label: SupervisorDecision.COMPRESS },
      { from: NODE.SUPERVISOR,       to: NODE.COMPRESSION,         label: SupervisorDecision.RETRY_COMPRESSION },
      { from: NODE.SUPERVISOR,       to: NODE.SEMANTIC_VALIDATOR,  label: SupervisorDecision.VALIDATE },
      { from: NODE.SUPERVISOR,       to: NODE.REVIEWER,            label: SupervisorDecision.REVIEW },
      { from: NODE.SUPERVISOR,       to: "END",                    label: SupervisorDecision.COMPLETE },
      { from: NODE.SUPERVISOR,       to: "END",                    label: SupervisorDecision.FAIL },
      { from: NODE.TOKEN_ANALYZER,   to: NODE.SUPERVISOR,          label: "done" },
      { from: NODE.COMPRESSION,      to: NODE.SUPERVISOR,          label: "done" },
      { from: NODE.SEMANTIC_VALIDATOR, to: NODE.SUPERVISOR,        label: "done" },
      { from: NODE.REVIEWER,         to: NODE.SUPERVISOR,          label: "done" },
    ],
  };
}
