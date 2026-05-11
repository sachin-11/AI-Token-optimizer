"use client";

/**
 * useOptimizationStream
 *
 * React hook that connects to the SSE streaming endpoint and
 * progressively updates state as each agent completes.
 *
 * Why a custom hook over EventSource:
 * - EventSource only supports GET — we need POST (body with prompt)
 * - fetch() + ReadableStream gives us POST + streaming
 * - Full TypeScript types on every event
 * - Automatic cleanup on unmount
 */

import { useCallback, useRef, useState } from "react";

import type {
  CompletePayload,
  CompressionDeltaPayload,
  OptimizeStreamRequest,
  ProgressPayload,
  ReviewResultPayload,
  SSEEnvelope,
  StreamingPhase,
  StreamingState,
  TokenCountPayload,
  ValidationResultPayload,
} from "@/types/streaming";
import { AgentName } from "@/types/agent";

// ─── Initial State ────────────────────────────────────────────────────────────

const INITIAL_STATE: StreamingState = {
  phase:            "idle",
  isStreaming:      false,
  progress:         0,
  currentAgent:     null,
  message:          "",
  events:           [],
  tokenCount:       null,
  compressionDelta: null,
  validationResult: null,
  reviewResult:     null,
  finalResult:      null,
  error:            null,
};

// ─── Agent → Phase mapping ────────────────────────────────────────────────────

const AGENT_PHASE: Partial<Record<AgentName, StreamingPhase>> = {
  [AgentName.TOKEN_ANALYZER]:     "analyzing",
  [AgentName.COMPRESSION]:        "compressing",
  [AgentName.SEMANTIC_VALIDATOR]: "validating",
  [AgentName.REVIEWER]:           "reviewing",
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOptimizationStream() {
  const [state, setState] = useState<StreamingState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const updateState = useCallback((patch: Partial<StreamingState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  /**
   * Start streaming optimization for a prompt.
   */
  const optimize = useCallback(async (request: OptimizeStreamRequest) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...INITIAL_STATE,
      phase:       "connecting",
      isStreaming: true,
      message:     "Connecting…",
    });

    try {
      const response = await fetch("/api/v1/optimize/stream", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(request),
        signal:  controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by \n\n
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          if (!message.trim() || message.startsWith(":")) continue; // heartbeat

          // Extract data line
          const dataLine = message.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;

          const jsonStr = dataLine.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const envelope = JSON.parse(jsonStr) as SSEEnvelope<unknown>;
            handleEvent(envelope, updateState);
          } catch {
            // Malformed JSON — skip
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;

      updateState({
        phase:       "error",
        isStreaming: false,
        error:       error instanceof Error ? error.message : "Stream failed",
      });
    }
  }, [updateState]);

  /**
   * Cancel the in-flight stream.
   */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    updateState({ phase: "idle", isStreaming: false, message: "Cancelled" });
  }, [updateState]);

  /**
   * Reset to initial state.
   */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { state, optimize, cancel, reset };
}

// ─── Event Handler ────────────────────────────────────────────────────────────

function handleEvent(
  envelope: SSEEnvelope<unknown>,
  update: (patch: Partial<StreamingState>) => void,
) {
  switch (envelope.type) {
    case "progress":
    case "agent_start": {
      const d = envelope.data as ProgressPayload;
      update({
        phase:        "analyzing",
        message:      d.message,
        progress:     d.percentComplete,
        currentAgent: d.agent ?? null,
        events:       [],
      });
      break;
    }

    case "agent_complete": {
      const d = envelope.data as ProgressPayload;
      const phase = d.agent ? (AGENT_PHASE[d.agent] ?? "analyzing") : "analyzing";
      update({
        phase,
        message:      d.message,
        progress:     d.percentComplete,
        currentAgent: d.agent ?? null,
      });
      break;
    }

    case "token_count": {
      update({ tokenCount: envelope.data as TokenCountPayload, phase: "analyzing" });
      break;
    }

    case "compression_delta": {
      update({ compressionDelta: envelope.data as CompressionDeltaPayload, phase: "compressing" });
      break;
    }

    case "validation_result": {
      update({ validationResult: envelope.data as ValidationResultPayload, phase: "validating" });
      break;
    }

    case "review_result": {
      update({ reviewResult: envelope.data as ReviewResultPayload, phase: "reviewing" });
      break;
    }

    case "complete": {
      update({
        phase:        "complete",
        isStreaming:  false,
        progress:     100,
        message:      "Optimization complete",
        finalResult:  envelope.data as CompletePayload,
        currentAgent: null,
      });
      break;
    }

    case "error": {
      const d = envelope.data as { message: string };
      update({
        phase:       "error",
        isStreaming: false,
        error:       d.message,
        message:     d.message,
      });
      break;
    }
  }
}
