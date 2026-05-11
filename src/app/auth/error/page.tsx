import Link from "next/link";

interface AuthErrorPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-destructive">Authentication Error</h1>
        <p className="text-sm text-muted-foreground">
          {error ?? "An unexpected error occurred during sign-in."}
        </p>
        <Link
          href="/auth/signin"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </Link>
      </div>
    </div>
  );
}
