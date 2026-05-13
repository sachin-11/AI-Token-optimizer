import "server-only";

import Credentials from "next-auth/providers/credentials";

import { getUserRepository } from "@/repositories/user.repository";
import { UserRole } from "@/types/auth";

export const DEV_CREDENTIALS_SYNTHETIC_ID = "dev-credentials-local";

/**
 * Check whether email/password login is enabled.
 * Controlled by ENABLE_CREDENTIALS_LOGIN env var — works in any NODE_ENV.
 */
export function isDevCredentialsEnabled(): boolean {
  return process.env.ENABLE_CREDENTIALS_LOGIN === "true";
}

/**
 * Email/password credentials provider.
 * Enabled when ENABLE_CREDENTIALS_LOGIN=true (set in .env or Vercel dashboard).
 * Email and password are read from DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD env vars.
 */
export function createDevCredentialsProvider() {
  return Credentials({
    id: "credentials",
    name: "Email",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      // Guard — reject immediately if credentials login is disabled
      if (!isDevCredentialsEnabled()) return null;

      const rawEmail = credentials?.email;
      const rawPassword = credentials?.password;
      if (typeof rawEmail !== "string" || typeof rawPassword !== "string") return null;

      const email = rawEmail.trim().toLowerCase();
      const password = rawPassword;

      const expectedEmail = (process.env.DEV_LOGIN_EMAIL ?? "sachin@moontechnolabs.com")
        .trim()
        .toLowerCase();
      const expectedPassword = process.env.DEV_LOGIN_PASSWORD ?? "123456";

      if (email !== expectedEmail || password !== expectedPassword) return null;

      // Try to find or create the user in the DB
      try {
        const repo = getUserRepository();
        let user = await repo.findByEmail(expectedEmail);
        if (!user) {
          user = await repo.create({ email: expectedEmail, name: "Admin" });
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? "Admin",
          role: user.role as UserRole,
          apiKey: user.apiKey,
        };
      } catch {
        // DB unreachable — still return a synthetic session so the app is usable
        return {
          id: DEV_CREDENTIALS_SYNTHETIC_ID,
          email: expectedEmail,
          name: "Admin",
          role: UserRole.ADMIN,
          apiKey: "",
        };
      }
    },
  });
}
