import { createWebhookApiHandler } from "./payments-api.js";
import { NoopPaymentsWorkspaceRepository } from "../repos/payments-workspace.js";

export const handler = createWebhookApiHandler(new NoopPaymentsWorkspaceRepository());
