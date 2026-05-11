import "server-only";

import Credentials from "next-auth/providers/credentials";

import { getUserRepository } from "@/repositories/user.repository";
import { UserRole } from "@/types/auth";

/** Used when DB is unreachable but dev password matches — JWT still works. */
export const DEV_CREDENTIALS_SYNTHETIC_ID = "dev-credentials-local";

/**
 * Email/password login for local development when OAuth keys are not configured.
 * Defaults match .env.example; override with DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD.
 */
export function createDevCredentialsProvider() {
  return Credentials({
    id: "credentials",
    name: "Email (development)",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (process.env.NODE_ENV !== "development") return null;

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

      try {
        const repo = getUserRepository();
        let user = await repo.findByEmail(expectedEmail);
        if (!user) {
          user = await repo.create({ email: expectedEmail, name: "Dev User" });
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? "Dev User",
          role: user.role as UserRole,
          apiKey: user.apiKey,
        };
      } catch {
        return {
          id: DEV_CREDENTIALS_SYNTHETIC_ID,
          email: expectedEmail,
          name: "Dev User",
          role: UserRole.USER,
          apiKey: "",
        };
      }
    },
  });
}

export function isDevCredentialsEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}
