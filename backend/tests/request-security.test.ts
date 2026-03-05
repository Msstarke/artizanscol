import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { SecurityPolicyError, enforceRequestSecurity } from "../src/middleware/request-security.js";

function eventStub(args: {
  method?: string;
  headers?: Record<string, string>;
  sub?: string;
}): APIGatewayProxyEventV2 {
  const method = args.method || "GET";
  const headers = args.headers || {};

  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers,
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "example.execute-api.ap-southeast-2.amazonaws.com",
      domainPrefix: "example",
      http: {
        method,
        path: "/",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "node-test",
      },
      requestId: "request-id",
      routeKey: "$default",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      authorizer: args.sub
        ? {
            jwt: {
              claims: {
                sub: args.sub,
              },
              scopes: [],
            },
          }
        : undefined,
    } as APIGatewayProxyEventV2["requestContext"] & {
      authorizer?: {
        jwt?: {
          claims?: Record<string, string>;
          scopes?: string[];
        };
      };
    },
    isBase64Encoded: false,
    body: undefined,
    pathParameters: undefined,
    queryStringParameters: undefined,
    stageVariables: undefined,
    cookies: undefined,
  };
}

test("allows non-mutating requests without bearer token", () => {
  assert.doesNotThrow(() => enforceRequestSecurity(eventStub({ method: "GET" })));
});

test("blocks mutating requests without bearer token or jwt context", () => {
  assert.throws(
    () => enforceRequestSecurity(eventStub({ method: "POST" })),
    (error) => {
      assert.ok(error instanceof SecurityPolicyError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "UNAUTHENTICATED");
      return true;
    },
  );
});

test("allows mutating requests with bearer token", () => {
  assert.doesNotThrow(() =>
    enforceRequestSecurity(
      eventStub({
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
        },
      }),
    ));
});

test("allows mutating requests when trusted jwt context is present", () => {
  assert.doesNotThrow(() =>
    enforceRequestSecurity(
      eventStub({
        method: "PATCH",
        sub: "user-1",
      }),
    ));
});

test("requires csrf token when cookie credentials are present", () => {
  assert.throws(
    () =>
      enforceRequestSecurity(
        eventStub({
          method: "POST",
          headers: {
            cookie: "session=abc",
            origin: "https://app.artizanscollective.com",
            authorization: "Bearer test-token",
          },
        }),
      ),
    /CSRF token is required/,
  );
});

test("requires origin or referer on cookie-based mutating requests", () => {
  assert.throws(
    () =>
      enforceRequestSecurity(
        eventStub({
          method: "POST",
          headers: {
            cookie: "session=abc",
            "x-csrf-token": "token",
            authorization: "Bearer test-token",
          },
        }),
      ),
    /Origin or referer header is required/,
  );
});

test("enforces APP_ALLOWED_ORIGINS for cookie-based requests", () => {
  const previous = process.env.APP_ALLOWED_ORIGINS;
  process.env.APP_ALLOWED_ORIGINS = "https://app.artizanscollective.com";
  try {
    assert.throws(
      () =>
        enforceRequestSecurity(
          eventStub({
            method: "POST",
            headers: {
              cookie: "session=abc",
              "x-csrf-token": "token",
              origin: "https://evil.example.com",
              authorization: "Bearer test-token",
            },
          }),
        ),
      /Origin is not allowed/,
    );
  } finally {
    if (previous == null) {
      delete process.env.APP_ALLOWED_ORIGINS;
    } else {
      process.env.APP_ALLOWED_ORIGINS = previous;
    }
  }
});

test("allows cookie-based requests when origin is allowed", () => {
  const previous = process.env.APP_ALLOWED_ORIGINS;
  process.env.APP_ALLOWED_ORIGINS = "https://app.artizanscollective.com";
  try {
    assert.doesNotThrow(() =>
      enforceRequestSecurity(
        eventStub({
          method: "POST",
          headers: {
            cookie: "session=abc",
            "x-csrf-token": "token",
            referer: "https://app.artizanscollective.com/account-settings.html",
            authorization: "Bearer test-token",
          },
        }),
      ));
  } finally {
    if (previous == null) {
      delete process.env.APP_ALLOWED_ORIGINS;
    } else {
      process.env.APP_ALLOWED_ORIGINS = previous;
    }
  }
});
