/**
 * Edge-safe Auth.js config (no Prisma, no DB imports).
 * Use with `NextAuth(authConfig)` in middleware only.
 *
 * OAuth + session persistence run in Node via `auth.ts`, which spreads this
 * config and adds PrismaAdapter + DB-backed callbacks.
 */

import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { UserRole } from "@/types/auth";

export const authConfig = {
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    }),
  ],

  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-next-auth.csrf-token"
          : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },

  callbacks: {
    /**
     * Middleware runs this without DB access. Only enrich when `user` is
     * present (handled on Node in the full `auth.ts` instance during OAuth).
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user.role as UserRole) ?? UserRole.USER;
        token.apiKey = user.apiKey;
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.apiKey = token.apiKey as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
    signOut: "/auth/signout",
  },

  debug: process.env.NODE_ENV === "development",
} satisfies NextAuthConfig;
