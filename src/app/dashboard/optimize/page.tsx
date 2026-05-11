"use client";

import { Loader2, Sparkles, StopCircle, Wand2 } from "lucide-react";
import { useState } from "react";

import { Header } from "@/components/shared/header";
import { StreamProgress } from "@/components/features/optimizer/stream-progress";
import { OptimizationResult } from "@/components/features/optimizer/optimization-result";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useOptimizationStream } from "@/hooks/use-optimization-stream";

const MODELS = [
  { value: "gpt-4o",       label: "GPT-4o" },
  { value: "gpt-4o-mini",  label: "GPT-4o Mini" },
  { value: "gpt-4-turbo",  label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo",label: "GPT-3.5 Turbo" },
];

const MODES = [
  { value: "safe",       label: "Safe",       description: "5-15% reduction, minimal risk" },
  { value: "balanced",   label: "Balanced",   description: "15-35% reduction, low risk" },
  { value: "aggressive", label: "Aggressive", description: "35-60% reduction, moderate risk" },
];

const EXAMPLE_PROMPT = `You are a helpful AI assistant. I would like you to please help me with the following task. In order to complete this task, you will need to carefully analyze the information that I am providing to you and then generate a comprehensive response.

The task that I need you to help me with is to write a Python function that takes a list of numbers as input and returns the sum of all the even numbers in the list. Please make sure that you include proper error handling and also add comments to explain what the code is doing.

It is important to note that the function should work correctly for all edge cases, including empty lists and lists with no even numbers. Please make sure that you test your implementation thoroughly.`;

export default function OptimizePage() {
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [model, setModel] = useState("gpt-4o-mini");
  const [mode, setMode] = useState<"safe" | "balanced" | "aggressive">("balanced");

  const { state, optimize, cancel, reset } = useOptimizationStream();

  const handleOptimize = () => {
    if (!prompt.trim()) return;
    optimize({ prompt, model, mode });
  };

  const handleReset = () => {
    reset();
  };

  const charCount = prompt.length;
  const estimatedTokens = Math.ceil(charCount / 4);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        title="Optimization Playground"
        description="Compress and optimize prompts with AI-powered analysis"
      />

      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Left panel — input */}
        <div className="flex w-1/2 flex-col border-r">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">Input Prompt</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                ~{estimatedTokens.toLocaleString()} tokens
              </span>
              <Badge variant="outline" className="text-xs">{charCount} chars</Badge>
            </div>
          </div>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your prompt here…"
            className="flex-1 resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
          />

          {/* Controls */}
          <div className="border-t p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex rounded-md border text-xs">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value as typeof mode)}
                    title={m.description}
                    className={`px-2.5 py-1.5 transition-colors first:rounded-l-md last:rounded-r-md ${
                      mode === m.value
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex gap-2">
                {state.isStreaming ? (
                  <Button size="sm" variant="destructive" onClick={cancel} className="gap-1.5">
                    <StopCircle className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                ) : (
                  <>
                    {state.phase !== "idle" && (
                      <Button size="sm" variant="outline" onClick={handleReset}>
                        Reset
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={handleOptimize}
                      disabled={!prompt.trim()}
                      className="gap-1.5"
                    >
                      {state.phase === "idle" ? (
                        <><Wand2 className="h-3.5 w-3.5" /> Optimize</>
                      ) : (
                        <><Sparkles className="h-3.5 w-3.5" /> Re-optimize</>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — output */}
        <div className="flex w-1/2 flex-col overflow-y-auto">
          <div className="flex items-center border-b px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">Optimization Output</span>
            {state.isStreaming && (
              <div className="ml-2 flex items-center gap-1.5 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Processing…</span>
              </div>
            )}
          </div>

          <div className="flex-1 p-4">
            {state.phase === "idle" && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Wand2 className="h-6 w-6 text-primary" />
                </div>
                <p className="mt-3 text-sm font-medium">Ready to optimize</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter a prompt and click Optimize to start
                </p>
              </div>
            )}

            {(state.isStreaming || (state.phase !== "idle" && state.phase !== "complete" && state.phase !== "error")) && (
              <div className="space-y-4">
                <StreamProgress state={state} />

                {/* Live partial results */}
                {state.tokenCount && (
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-xs text-muted-foreground">Token Analysis</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span>Original tokens</span>
                        <span className="font-mono font-medium">
                          {state.tokenCount.originalTokens.toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <span>Urgency</span>
                        <Badge
                          variant={
                            state.tokenCount.urgency === "critical" ? "destructive"
                            : state.tokenCount.urgency === "high" ? "warning"
                            : "secondary"
                          }
                          className="text-xs"
                        >
                          {state.tokenCount.urgency}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {state.compressionDelta && (
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-xs text-muted-foreground">Compression Progress</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span>{state.compressionDelta.originalTokens} → {state.compressionDelta.currentTokens} tokens</span>
                        <span className="font-medium text-emerald-600">
                          -{state.compressionDelta.percentReduction.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${state.compressionDelta.percentReduction}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {state.phase === "complete" && state.finalResult && (
              <OptimizationResult
                result={state.finalResult}
                originalPrompt={prompt}
              />
            )}

            {state.phase === "error" && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-destructive">Optimization failed</p>
                <p className="mt-1 text-xs text-muted-foreground">{state.error}</p>
                <Button size="sm" variant="outline" onClick={handleReset} className="mt-4">
                  Try again
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
