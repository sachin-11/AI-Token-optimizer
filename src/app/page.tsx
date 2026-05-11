import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          AI Prompt Optimizer
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Production-grade prompt optimization platform — dashboard, playground, analytics, and history.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href="/auth/signin">Sign in</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Open dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
