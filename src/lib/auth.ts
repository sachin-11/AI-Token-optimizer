/**
 * NextAuth v5 — full Node configuration (Prisma adapter + DB callbacks).
 * Route handlers import `handlers` from here. Server code uses `auth` from here.
 *
 * Middleware must NOT import this file — use `auth.config.ts` via `NextAuth(authConfig)`
 * so Prisma is never bundled into the Edge runtime.
 */

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { createDevCredentialsProvider, DEV_CREDENTIALS_SYNTHETIC_ID, isDevCredentialsEnabled } from "@/lib/auth-dev-credentials";
import { authConfig } from "@/lib/auth.config";
import { prisma } from "@/lib/prisma";
import { getUserRepository } from "@/repositories/user.repository";
import { UserRole } from "@/types/auth";

const devProviders = isDevCredentialsEnabled() ? [createDevCredentialsProvider()] : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [...devProviders, ...authConfig.providers],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user.role as UserRole) ?? UserRole.USER;
        token.apiKey = user.apiKey;
        return token;
      }

      if (token.id && token.id !== DEV_CREDENTIALS_SYNTHETIC_ID) {
        const dbUser = await getUserRepository().findById(token.id as string);
        if (dbUser) {
          token.role = dbUser.role as UserRole;
          token.apiKey = dbUser.apiKey;
        }
      }

      return token;
    },

    async signIn({ user, account }) {
      if (!user?.email) return false;

      if (account?.provider === "credentials") return true;

      const repo = getUserRepository();
      const existing = await repo.findByEmail(user.email);

      if (!existing) {
        await repo.create({ email: user.email, name: user.name ?? undefined });
      }

      return true;
    },
  },
});
