import type { APIGatewayProxyEventV2 } from "aws-lambda";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class SecurityPolicyError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function header(event: APIGatewayProxyEventV2, name: string): string {
  const wanted = name.toLowerCase();
  const headers = event.headers || {};

  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) {
      return String(value || "").trim();
    }
  }

  return "";
}

function hasTrustedJwtContext(event: APIGatewayProxyEventV2): boolean {
  const requestContext = event.requestContext as {
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
      };
    };
  };
  const claims = requestContext.authorizer?.jwt?.claims;
  const sub = String(claims?.sub || "").trim();
  return Boolean(sub);
}

function allowedOriginsFromEnv(): string[] {
  const raw = String(process.env.APP_ALLOWED_ORIGINS || "").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
}

function normalizeOrigin(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }

  try {
    return new URL(value).origin.toLowerCase();
  } catch (_) {
    return "";
  }
}

function matchesAllowedOrigin(origin: string, allowed: string[]): boolean {
  if (!allowed.length) {
    return true;
  }

  if (allowed.includes("*")) {
    return true;
  }

  return allowed.includes(origin);
}

function ensureBearerForMutations(event: APIGatewayProxyEventV2): void {
  const method = String(event.requestContext.http.method || "").toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return;
  }

  const authHeader = header(event, "authorization");
  if (/^Bearer\s+\S+$/i.test(authHeader)) {
    return;
  }

  if (hasTrustedJwtContext(event)) {
    return;
  }

  {
    throw new SecurityPolicyError(401, "UNAUTHENTICATED", "Bearer token is required for mutating requests.");
  }
}

function ensureCsrfForCookieFlows(event: APIGatewayProxyEventV2): void {
  const method = String(event.requestContext.http.method || "").toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return;
  }

  const cookieHeader = header(event, "cookie");
  if (!cookieHeader) {
    return;
  }

  const csrfToken = header(event, "x-csrf-token");
  if (!csrfToken) {
    throw new SecurityPolicyError(
      403,
      "CSRF_FAILED",
      "CSRF token is required when cookie credentials are present.",
    );
  }

  const originHeader = header(event, "origin") || header(event, "referer");
  const allowedOrigins = allowedOriginsFromEnv();
  const origin = normalizeOrigin(originHeader);

  if (!origin) {
    throw new SecurityPolicyError(
      403,
      "CSRF_FAILED",
      "Origin or referer header is required for cookie-based mutating requests.",
    );
  }

  if (!matchesAllowedOrigin(origin, allowedOrigins)) {
    throw new SecurityPolicyError(
      403,
      "CSRF_FAILED",
      "Origin is not allowed for cookie-based mutating requests.",
    );
  }
}

export function enforceRequestSecurity(
  event: APIGatewayProxyEventV2,
  options: {
    requireBearerForMutations?: boolean;
  } = {},
): void {
  if (options.requireBearerForMutations !== false) {
    ensureBearerForMutations(event);
  }

  ensureCsrfForCookieFlows(event);
}
