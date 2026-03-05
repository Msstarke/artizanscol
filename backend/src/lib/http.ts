import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type JsonResponseOptions = {
  cacheControl?: string;
  headers?: Record<string, string>;
};

export function json(
  statusCode: number,
  body: unknown,
  options: JsonResponseOptions = {},
): APIGatewayProxyStructuredResultV2 {
  const cacheControl = options.cacheControl || "no-store";

  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "x-content-type-options": "nosniff",
      ...(options.headers || {}),
    },
    body: JSON.stringify(body),
  };
}
