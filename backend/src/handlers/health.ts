import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { success } from "../domain/api-response.js";
import { json } from "../lib/http.js";

export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return json(
    200,
    success({
      service: "artizans-backend",
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );
}
