"use client";

/**
 * Global Error Boundary — Client Component
 * Cannot import server-only modules here.
 */

import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to browser console in development
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="mx-auto max-w-md text-center">
        <h2 className="text-2xl font-bold text-foreground">Something went wrong</h2>
        <p className="mt-2 text-muted-foreground">
          {error.message || "An unexpected error occurred"}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
