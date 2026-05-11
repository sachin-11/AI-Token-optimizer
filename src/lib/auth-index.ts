// Core auth
export { auth, signIn, signOut, handlers } from "./auth";

// Utilities
export {
  getSession,
  requireSession,
  getAuthContext,
  requireAuthContext,
  validateApiKey,
  resolveAuth,
  requireResolvedAuth,
} from "./auth-utils";

// RBAC
export {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  isAtLeastRole,
  requireAuth,
  requirePermission,
  requireRole,
  requireOwnerOrAdmin,
  getPermissionsForRole,
} from "./rbac";

// Guards
export {
  withAuth,
  withRole,
  withPermission,
  withAdmin,
  withSuperAdmin,
} from "./auth-guards";
