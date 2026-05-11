"use server";

import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth";

export async function signInWithDevCredentials(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const password = formData.get("password");
  const callbackUrlRaw = formData.get("callbackUrl");
  const callbackUrl = typeof callbackUrlRaw === "string" && callbackUrlRaw.length > 0 ? callbackUrlRaw : "/dashboard";

  if (typeof email !== "string" || typeof password !== "string") {
    redirect("/auth/signin?error=CredentialsSignin");
  }

  await signIn("credentials", {
    email: email.trim(),
    password,
    redirectTo: callbackUrl,
  });
}
