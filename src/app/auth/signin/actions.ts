"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";

import { signIn } from "@/lib/auth";

export async function signInWithDevCredentials(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const password = formData.get("password");
  const callbackUrlRaw = formData.get("callbackUrl");
  const callbackUrl =
    typeof callbackUrlRaw === "string" && callbackUrlRaw.length > 0 ? callbackUrlRaw : "/dashboard";

  if (typeof email !== "string" || typeof password !== "string") {
    redirect("/auth/signin?error=CredentialsSignin");
  }

  try {
    await signIn("credentials", {
      email: email.trim(),
      password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    // NEXT_REDIRECT is not a real error — Next.js throws it internally to
    // perform the redirect after a successful sign-in. Let it propagate.
    if (isRedirectError(error)) throw error;

    // Any other error (wrong password, DB down, CSRF mismatch, etc.)
    // → send user back to sign-in page with a generic error message.
    console.error("[SignIn] credentials auth failed:", error);
    redirect("/auth/signin?error=CredentialsSignin");
  }
}
