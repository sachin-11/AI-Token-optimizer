"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { cn } from "@/utils/cn";
import { AgentName } from "@/types/agent";
import type { StreamingPhase, StreamingState } from "@/types/streaming";

// ─── Step Config ──────────────────────────────────────────────────────────────

const STEPS: Array<{
  agent: AgentName;
  label: string;
  phase: StreamingPhase;
  description: string;
}> = [
  { agent: AgentName.TOKEN_ANALYZER,     label: "Token Analysis",      phase: "analyzing",   description: "Counting tokens & analyzing context" },
  { agent: AgentName.COMPRESSION,        label: "Compression",         phase: "compressing", description: "Applying optimization strategies" },
  { agent: AgentName.SEMANTIC_VALIDATOR, label: "Semantic Validation",  phase: "validating",  description: "Verifying meaning preservation" },
  { agent: AgentName.REVIEWER,           label: "Quality Review",       phase: "reviewing",   description: "Scoring optimization quality" },
];

const PHASE_ORDER: StreamingPhase[] = ["idle", "connecting", "analyzing", "compressing", "validating", "reviewing", "complete", "error"];

function getStepStatus(
  stepPhase: StreamingPhase,
  currentPhase: StreamingPhase,
): "pending" | "active" | "done" | "error" {
  if (currentPhase === "error") return "pending";
  const stepIdx    = PHASE_ORDER.indexOf(stepPhase);
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  if (currentIdx > stepIdx) return "done";
  if (currentIdx === stepIdx) return "active";
  return "pending";
}

// ─── Component ────────────────────────────────────────────────────────────────

interface StreamProgressProps {
  state: StreamingState;
}

export function StreamProgress({ state }: StreamProgressProps) {
  if (state.phase === "idle") return null;

  return (
    <div className="space-y-4">
      {/* Overall progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{state.message || "Processing…"}</span>
          <span>{state.progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      </div>

      {/* Agent steps */}
      <div className="space-y-2">
        {STEPS.map((step) => {
          const status = getStepStatus(step.phase, state.phase);
          return (
            <div key={step.agent} className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {status === "done"   && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {status === "active" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {status === "pending"&& <Circle className="h-4 w-4 text-muted-foreground/40" />}
                {status === "error"  && <XCircle className="h-4 w-4 text-destructive" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn(
                  "text-sm font-medium leading-none",
                  status === "done"    && "text-foreground",
                  status === "active"  && "text-primary",
                  status === "pending" && "text-muted-foreground",
                )}>
                  {step.label}
                </p>
                {status === "active" && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error message */}
      {state.phase === "error" && state.error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </div>
      )}
    </div>
  );
}
