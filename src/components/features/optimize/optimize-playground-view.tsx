"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Header } from "@/components/shared/header";
import { PromptEditor } from "@/components/features/prompts/prompt-editor";
import { StreamingText } from "@/components/features/ai/streaming-text";
import { OptimizationComparison } from "@/components/features/optimization/optimization-comparison";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SAMPLE_PROMPT_AFTER, SAMPLE_PROMPT_BEFORE, SAMPLE_STREAM_COMPLETION } from "@/lib/dashboard-demo-data";

export function OptimizePlaygroundView() {
  const [streamKey, setStreamKey] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const runOptimize = () => {
    setError(null);
    setStreaming(true);
    setProgress(12);
    setStreamKey((k) => k + 1);
  };

  useEffect(() => {
    if (!streaming) return;
    const id = window.setInterval(() => {
      setProgress((p) => (p >= 88 ? p : p + 7));
    }, 320);
    return () => window.clearInterval(id);
  }, [streaming, streamKey]);

  return (
    <>
      <Header
        title="Optimization playground"
        description="Edit prompts, stream optimizer output, and compare token impact."
      />
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {error ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm text-destructive">Pipeline error</CardTitle>
                  <CardDescription className="text-destructive/80">{error}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" onClick={() => setError(null)}>
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <PromptEditor
            initialValue={SAMPLE_PROMPT_BEFORE}
            onOptimize={runOptimize}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setError("Optimizer worker timed out (demo). Check API keys and retry.")
              }
            >
              Simulate error
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Streaming output</CardTitle>
              <CardDescription>Token-by-token style delivery of optimizer notes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {streaming ? (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Pipeline</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <StreamingText
                      key={streamKey}
                      text={SAMPLE_STREAM_COMPLETION}
                      active={streaming}
                      onComplete={() => {
                        setProgress(100);
                        setStreaming(false);
                      }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Run Optimize to stream analyzer output here.
                </p>
              )}
            </CardContent>
          </Card>

          <OptimizationComparison before={SAMPLE_PROMPT_BEFORE} after={SAMPLE_PROMPT_AFTER} />
        </div>
      </main>
    </>
  );
}
