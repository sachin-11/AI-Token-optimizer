/**
 * RBAC — Role-Based Access Control
 *
 * Pure functions — no side effects, fully testable.
 * Guards and middleware call these to make access decisions.
 */

import "server-only";

import { Permission, ROLE_PERMISSIONS, UserRole } from "@/types/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

// ─── Permission Checks ────────────────────────────────────────────────────────

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

export function isAtLeastRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const hierarchy: Record<UserRole, number> = {
    [UserRole.USER]:        0,
    [UserRole.ADMIN]:       1,
    [UserRole.SUPER_ADMIN]: 2,
  };
  return (hierarchy[userRole] ?? 0) >= (hierarchy[requiredRole] ?? 0);
}

// ─── Guard Functions (throw on failure) ──────────────────────────────────────

export function requireAuth(userId: string | undefined): asserts userId is string {
  if (!userId) throw new UnauthorizedError();
}

export function requirePermission(role: UserRole | undefined, permission: Permission): void {
  if (!role) throw new UnauthorizedError();
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError(`Permission required: ${permission}`);
  }
}

export function requireRole(userRole: UserRole | undefined, requiredRole: UserRole): void {
  if (!userRole) throw new UnauthorizedError();
  if (!isAtLeastRole(userRole, requiredRole)) {
    throw new ForbiddenError(`Role required: ${requiredRole}`);
  }
}

export function requireOwnerOrAdmin(
  userId: string,
  resourceOwnerId: string,
  userRole: UserRole,
): void {
  if (userId !== resourceOwnerId && !isAtLeastRole(userRole, UserRole.ADMIN)) {
    throw new ForbiddenError("You can only access your own resources");
  }
}

// ─── Permission List Helpers ──────────────────────────────────────────────────

export function getPermissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
