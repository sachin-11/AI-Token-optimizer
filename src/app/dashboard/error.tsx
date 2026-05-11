"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="max-w-md border-destructive/30">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-destructive">This view failed to load</CardTitle>
              <CardDescription className="text-destructive/80">
                {error.message || "Unexpected error in the dashboard route."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {error.digest ? (
              <p className="w-full font-mono text-xs text-muted-foreground">ID: {error.digest}</p>
            ) : null}
            <Button onClick={reset} size="sm">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
