import type { AppRole, AuthIdentity } from "../domain/auth.js";
import { AuthzError } from "../domain/auth.js";

export function requireAnyRole(identity: AuthIdentity, allowedRoles: AppRole[]): void {
  if (!allowedRoles.length) {
    return;
  }

  const hasRole = identity.roles.some((role) => allowedRoles.includes(role));
  if (!hasRole) {
    throw new AuthzError("FORBIDDEN", "You do not have permission to access this resource.");
  }
}

export function requireAdmin(identity: AuthIdentity): void {
  requireAnyRole(identity, ["admin"]);
}

export function requireOwnership(
  identity: AuthIdentity,
  ownerSubjectId: string,
  options: { allowAdmin?: boolean } = {},
): void {
  const allowAdmin = options.allowAdmin ?? true;

  if (allowAdmin && identity.roles.includes("admin")) {
    return;
  }

  if (identity.sub !== ownerSubjectId) {
    throw new AuthzError("FORBIDDEN", "You do not own this resource.");
  }
}
