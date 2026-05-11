"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/cn";

interface PromptEditorProps {
  className?: string;
  initialValue?: string;
  onOptimize?: (text: string) => void;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function PromptEditor({ className, initialValue = "", onOptimize }: PromptEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [model, setModel] = useState("gpt-4o");

  const tokens = useMemo(() => estimateTokens(value), [value]);

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Prompt editor</CardTitle>
            <CardDescription>Draft, estimate tokens, and send to the optimization pipeline.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs">
              ~{tokens.toLocaleString()} tokens
            </Badge>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o">gpt-4o</SelectItem>
                <SelectItem value="gpt-4o-mini">gpt-4o-mini</SelectItem>
                <SelectItem value="claude-3-5-sonnet">claude-3.5-sonnet</SelectItem>
                <SelectItem value="gemini-1.5-pro">gemini-1.5-pro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe the task, constraints, and desired output shape..."
          className="min-h-[200px] resize-y font-mono text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => onOptimize?.(value)}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Optimize
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setValue("")}>
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { estimateTokens };
