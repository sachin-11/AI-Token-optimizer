"use client";

import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/cn";
import { estimateTokens } from "@/components/features/prompts/prompt-editor";

interface OptimizationComparisonProps {
  before: string;
  after: string;
  className?: string;
}

export function OptimizationComparison({ before, after, className }: OptimizationComparisonProps) {
  const tBefore = estimateTokens(before);
  const tAfter = estimateTokens(after);
  const saved = tBefore > 0 ? Math.round(((tBefore - tAfter) / tBefore) * 100) : 0;

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Optimization comparison</CardTitle>
            <CardDescription>Before and after prompt with estimated token impact.</CardDescription>
          </div>
          <Badge variant="secondary" className="text-xs">
            −{saved}% est. tokens
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Before</p>
            <p className="mt-2 font-mono text-xs leading-relaxed text-foreground">{before}</p>
            <p className="mt-3 text-xs text-muted-foreground">~{tBefore} tokens</p>
          </div>
          <div className="hidden items-center justify-center lg:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">After</p>
            <p className="mt-2 font-mono text-xs leading-relaxed text-foreground">{after}</p>
            <p className="mt-3 text-xs text-muted-foreground">~{tAfter} tokens</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
