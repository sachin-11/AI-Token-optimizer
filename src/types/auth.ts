/**
 * Auth & RBAC Type Definitions
 */

import type { DefaultSession, DefaultUser } from "next-auth";
import type { JWT as DefaultJWT } from "next-auth/jwt";

// ─── Roles & Permissions ──────────────────────────────────────────────────────

export enum UserRole {
  USER        = "USER",
  ADMIN       = "ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
}

export enum Permission {
  // Prompt operations
  PROMPT_READ    = "prompt:read",
  PROMPT_WRITE   = "prompt:write",
  PROMPT_DELETE  = "prompt:delete",

  // Optimization
  OPTIMIZE_RUN   = "optimize:run",
  OPTIMIZE_READ  = "optimize:read",

  // Analytics
  ANALYTICS_READ = "analytics:read",

  // Admin
  USERS_READ     = "users:read",
  USERS_WRITE    = "users:write",
  USERS_DELETE   = "users:delete",
  SYSTEM_CONFIG  = "system:config",
}

// Role → Permission mapping
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.USER]: [
    Permission.PROMPT_READ,
    Permission.PROMPT_WRITE,
    Permission.PROMPT_DELETE,
    Permission.OPTIMIZE_RUN,
    Permission.OPTIMIZE_READ,
    Permission.ANALYTICS_READ,
  ],
  [UserRole.ADMIN]: [
    Permission.PROMPT_READ,
    Permission.PROMPT_WRITE,
    Permission.PROMPT_DELETE,
    Permission.OPTIMIZE_RUN,
    Permission.OPTIMIZE_READ,
    Permission.ANALYTICS_READ,
    Permission.USERS_READ,
    Permission.USERS_WRITE,
  ],
  [UserRole.SUPER_ADMIN]: Object.values(Permission),
};

// ─── Session Augmentation ─────────────────────────────────────────────────────

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      role: UserRole;
      apiKey: string;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: UserRole;
    apiKey: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: UserRole;
    apiKey: string;
  }
}

// ─── Auth Context ─────────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  apiKey: string;
}

export interface ApiKeyContext {
  userId: string;
  email: string;
  role: UserRole;
}
