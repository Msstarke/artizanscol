import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  type AppRole,
  type AuthIdentity,
  AuthzError,
  parseDelimitedRoles,
} from "../domain/auth.js";
import {
  type RoleAssignmentsRepository,
  resolveEffectiveRoles,
} from "../repos/role-assignments.js";

const DEFAULT_AUTHENTICATED_ROLES: AppRole[] = ["user", "artist"];

type UnknownClaims = Record<string, unknown>;

function toStringMap(raw: UnknownClaims | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!raw || typeof raw !== "object") {
    return map;
  }

  for (const [key, value] of Object.entries(raw)) {
    if (value == null) {
      continue;
    }

    if (typeof value === "string") {
      map[key] = value;
      continue;
    }

    map[key] = String(value);
  }

  return map;
}

function readClaims(event: APIGatewayProxyEventV2): Record<string, string> {
  const requestContext = event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: UnknownClaims }; claims?: UnknownClaims };
  };

  const authorizer = requestContext.authorizer as
    | { jwt?: { claims?: UnknownClaims }; claims?: UnknownClaims }
    | undefined;

  if (authorizer?.jwt?.claims) {
    return toStringMap(authorizer.jwt.claims);
  }

  if (authorizer?.claims) {
    return toStringMap(authorizer.claims);
  }

  return {};
}

function extractClaimRoles(claims: Record<string, string>): AppRole[] {
  const roles = new Set<AppRole>();

  ["custom:roles", "roles", "role", "cognito:groups"].forEach((claimKey) => {
    const value = claims[claimKey];
    if (!value) {
      return;
    }
    parseDelimitedRoles(value).forEach((role) => roles.add(role));
  });

  return Array.from(roles);
}

export async function extractAuthIdentity(
  event: APIGatewayProxyEventV2,
  repo?: RoleAssignmentsRepository,
): Promise<AuthIdentity | null> {
  const claims = readClaims(event);
  const sub = String(claims.sub || "").trim();

  if (!sub) {
    return null;
  }

  const claimRoles = extractClaimRoles(claims);
  const roles = repo
    ? await resolveEffectiveRoles({
        subjectId: sub,
        claimRoles,
        repository: repo,
        defaultRoles: DEFAULT_AUTHENTICATED_ROLES,
      })
    : claimRoles.length
      ? claimRoles
      : DEFAULT_AUTHENTICATED_ROLES;

  return {
    sub,
    email: String(claims.email || "").trim() || null,
    username: String(claims["cognito:username"] || "").trim() || null,
    roles,
    claims,
  };
}

export async function requireAuthIdentity(
  event: APIGatewayProxyEventV2,
  repo?: RoleAssignmentsRepository,
): Promise<AuthIdentity> {
  const identity = await extractAuthIdentity(event, repo);
  if (!identity) {
    throw new AuthzError("UNAUTHENTICATED", "Authentication is required.");
  }
  return identity;
}
