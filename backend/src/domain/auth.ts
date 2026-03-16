export const APP_ROLES = ["user", "artist", "admin"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type AuthIdentity = {
  sub: string;
  email: string | null;
  username: string | null;
  roles: AppRole[];
  claims: Record<string, string>;
};

export type AuthzErrorCode = "UNAUTHENTICATED" | "FORBIDDEN";

export class AuthzError extends Error {
  public readonly statusCode: number;
  public readonly code: AuthzErrorCode;

  constructor(code: AuthzErrorCode, message: string) {
    super(message);
    this.code = code;
    this.statusCode = code === "UNAUTHENTICATED" ? 401 : 403;
  }
}

export function isAppRole(value: string): value is AppRole {
  return APP_ROLES.includes(value as AppRole);
}

export function normalizeRole(raw: string): AppRole | null {
  const role = String(raw || "").trim().toLowerCase();
  return isAppRole(role) ? role : null;
}

export function normalizeRoles(values: Iterable<string>): AppRole[] {
  const set = new Set<AppRole>();
  for (const value of values) {
    const role = normalizeRole(value);
    if (role) {
      set.add(role);
    }
  }
  return Array.from(set);
}

export function parseDelimitedRoles(value: string): AppRole[] {
  if (!String(value || "").trim()) {
    return [];
  }

  const split = String(value)
    .replace(/^\[|]$/g, "")
    .split(/[\s,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return normalizeRoles(split);
}
