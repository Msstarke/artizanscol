import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { failure } from "../domain/api-response.js";
import { handler as publicHandler } from "../handlers/public-api.js";
import { handler as userHandler } from "../handlers/user-api.js";
import { handler as artistHandler } from "../handlers/artist-api.js";
import { handler as messagingHandler } from "../handlers/messaging-api.js";
import { handler as adminHandler } from "../handlers/admin-api.js";
import { handler as paymentsHandler } from "../handlers/payments-api.js";
import { handler as webhookHandler } from "../handlers/webhook-api.js";
import { handler as healthHandler } from "../handlers/health.js";
import { json } from "../lib/http.js";

type DomainHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

const DOMAIN_HANDLERS: Record<string, DomainHandler> = {
  public: publicHandler,
  user: userHandler,
  artist: artistHandler,
  messaging: messagingHandler,
  admin: adminHandler,
  payments: paymentsHandler,
  webhook: webhookHandler,
  health: healthHandler,
};

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const domainArea = String(process.env.DOMAIN_AREA || "").trim().toLowerCase();
  const selected = DOMAIN_HANDLERS[domainArea];

  if (!selected) {
    return json(
      500,
      failure(
        "MISCONFIGURED",
        `Unsupported DOMAIN_AREA '${domainArea || "(empty)"}'.`,
      ),
    );
  }

  return await selected(event);
}
