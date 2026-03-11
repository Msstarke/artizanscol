import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createWebhookApiHandler } from "./payments-api.js";
import { getPaymentsWorkspaceRepository } from "../repos/runtime.js";

let runtimeHandler: ReturnType<typeof createWebhookApiHandler> | null = null;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  runtimeHandler ||= createWebhookApiHandler(getPaymentsWorkspaceRepository());
  return await runtimeHandler(event);
};
