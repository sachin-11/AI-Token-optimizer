import { redirect } from "next/navigation";

import { signInWithDevCredentials } from "@/app/auth/signin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth, signIn } from "@/lib/auth";

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth();
  const { callbackUrl, error } = await searchParams;

  if (session?.user) redirect(callbackUrl ?? "/dashboard");

  const ERROR_MESSAGES: Record<string, string> = {
    OAuthSignin: "Error starting OAuth sign-in.",
    OAuthCallback: "Error during OAuth callback.",
    OAuthCreateAccount: "Could not create OAuth account.",
    EmailCreateAccount: "Could not create email account.",
    Callback: "Error during callback.",
    CredentialsSignin: "Invalid email or password.",
    Default: "An error occurred. Please try again.",
  };

  const isDev = process.env.NODE_ENV === "development";
  // Show email/password form whenever ENABLE_CREDENTIALS_LOGIN=true,
  // regardless of NODE_ENV (works in both dev and production).
  const showCredentials = process.env.ENABLE_CREDENTIALS_LOGIN === "true";
  const showGoogle = Boolean(process.env.GOOGLE_CLIENT_ID);
  const showGitHub = Boolean(process.env.GITHUB_CLIENT_ID);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">to AI Prompt Optimizer</p>
        </div>

        {error ? (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {ERROR_MESSAGES[error] ?? ERROR_MESSAGES["Default"]}
          </div>
        ) : null}

        {showCredentials ? (
          <div className="space-y-4">
            {isDev && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-center text-xs text-muted-foreground">
                Development login — set <span className="font-mono">DEV_LOGIN_EMAIL</span> /{" "}
                <span className="font-mono">DEV_LOGIN_PASSWORD</span> in env
              </div>
            )}
            <form action={signInWithDevCredentials} className="space-y-3">
              <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/dashboard"} />
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="Enter your email"
                  required
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  className="bg-background"
                />
              </div>
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          </div>
        ) : null}

        {showCredentials && (showGoogle || showGitHub) ? (
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>
        ) : null}

        {!showCredentials && (showGoogle || showGitHub) ? (
          <p className="text-center text-xs text-muted-foreground">Sign in with your provider</p>
        ) : null}

        <div className="space-y-3">
          {showGoogle ? (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: callbackUrl ?? "/dashboard" });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </form>
          ) : null}

          {showGitHub ? (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: callbackUrl ?? "/dashboard" });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                <GitHubIcon />
                Continue with GitHub
              </button>
            </form>
          ) : null}

          {!showGoogle && !showGitHub && !showCredentials ? (
            <p className="text-center text-sm text-muted-foreground">
              OAuth is not configured. Set{" "}
              <span className="font-mono text-xs">GOOGLE_CLIENT_ID</span> or{" "}
              <span className="font-mono text-xs">GITHUB_CLIENT_ID</span> in your environment.
            </p>
          ) : null}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          By signing in you agree to our Terms of Service.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}
