import { signOut } from "@/lib/auth";

export default function SignOutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-foreground">Sign out</h1>
        <p className="text-sm text-muted-foreground">Are you sure you want to sign out?</p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
