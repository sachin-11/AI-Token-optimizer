"use client";

import { ArrowDown, CheckCircle2, Copy, DollarSign, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import type { CompletePayload } from "@/types/streaming";

interface OptimizationResultProps {
  result: CompletePayload;
  originalPrompt: string;
}

export function OptimizationResult({ result, originalPrompt }: OptimizationResultProps) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"optimized" | "diff">("optimized");

  const compressionPct = Math.round((1 - result.compressionRatio) * 100);

  const copy = async () => {
    await navigator.clipboard.writeText(result.finalPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricChip
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Tokens saved"
          value={result.tokensSaved.toLocaleString()}
          color="text-blue-600 dark:text-blue-400"
          bg="bg-blue-50 dark:bg-blue-950/30"
        />
        <MetricChip
          icon={<ArrowDown className="h-3.5 w-3.5" />}
          label="Reduction"
          value={`${compressionPct}%`}
          color="text-emerald-600 dark:text-emerald-400"
          bg="bg-emerald-50 dark:bg-emerald-950/30"
        />
        <MetricChip
          icon={<DollarSign className="h-3.5 w-3.5" />}
          label="Cost saved"
          value={`$${result.costSavingsUsd.toFixed(5)}`}
          color="text-amber-600 dark:text-amber-400"
          bg="bg-amber-50 dark:bg-amber-950/30"
        />
        <MetricChip
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Quality"
          value={`${result.qualityScore}/100`}
          color="text-purple-600 dark:text-purple-400"
          bg="bg-purple-50 dark:bg-purple-950/30"
        />
      </div>

      {/* Result card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Optimized Prompt</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border text-xs">
                <button
                  onClick={() => setView("optimized")}
                  className={cn("px-2.5 py-1 transition-colors", view === "optimized" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  Result
                </button>
                <button
                  onClick={() => setView("diff")}
                  className={cn("px-2.5 py-1 transition-colors", view === "diff" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  Compare
                </button>
              </div>
              <Button size="sm" variant="outline" onClick={copy} className="h-7 gap-1.5 text-xs">
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {view === "optimized" ? (
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-mono text-sm leading-relaxed">
              {result.finalPrompt}
            </pre>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Original</p>
                <pre className="whitespace-pre-wrap rounded-md bg-red-50 p-3 font-mono text-xs leading-relaxed dark:bg-red-950/20">
                  {originalPrompt}
                </pre>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Optimized</p>
                <pre className="whitespace-pre-wrap rounded-md bg-emerald-50 p-3 font-mono text-xs leading-relaxed dark:bg-emerald-950/20">
                  {result.finalPrompt}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <Badge variant={result.status === "completed" ? "success" : "destructive"}>
          {result.status}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Completed in {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

function MetricChip({
  icon, label, value, color, bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg p-3", bg)}>
      <div className={cn("shrink-0", color)}>{icon}</div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-semibold", color)}>{value}</p>
      </div>
    </div>
  );
}
