import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { canTransitionBookingStatus } from "../domain/booking.js";
import { failure, success } from "../domain/api-response.js";
import type {
  BookingRecord,
  InvoiceRecord,
  NotificationOwnerRole,
  NotificationRecord,
  PayoutRecord,
} from "../domain/entities.js";
import { ownerReadKey } from "../domain/index-keys.js";
import { createRecordMeta, touchRecordMeta } from "../domain/record-meta.js";
import { auditLog } from "../lib/audit.js";
import { json } from "../lib/http.js";
import { type JsonSchema, parseJsonRequestBody, validateSchema } from "../lib/schema.js";
import { requireAuthIdentity } from "../middleware/auth-context.js";
import { requireAnyRole } from "../middleware/authorization.js";
import { SecurityPolicyError, enforceRequestSecurity } from "../middleware/request-security.js";
import {
  NoopRoleAssignmentsRepository,
  type RoleAssignmentsRepository,
} from "../repos/role-assignments.js";
import {
  NoopPaymentsWorkspaceRepository,
  type PaymentsWorkspaceRepository,
} from "../repos/payments-workspace.js";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_REASON_LENGTH = 500;
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
const CHECKOUT_SESSION_SCHEMA: JsonSchema = {
  type: "object",
  required: ["bookingId"],
  additionalProperties: true,
  properties: {
    bookingId: { type: "string", minLength: 1, maxLength: 80 },
    successUrl: { type: "string", minLength: 1, maxLength: 500, nullable: true },
    cancelUrl: { type: "string", minLength: 1, maxLength: 500, nullable: true },
    idempotencyKey: { type: "string", minLength: 1, maxLength: MAX_IDEMPOTENCY_KEY_LENGTH, nullable: true },
  },
};
const REFUND_REQUEST_SCHEMA: JsonSchema = {
  type: "object",
  required: ["bookingId"],
  additionalProperties: true,
  properties: {
    bookingId: { type: "string", minLength: 1, maxLength: 80 },
    reason: { type: "string", minLength: 1, maxLength: MAX_REASON_LENGTH, nullable: true },
    idempotencyKey: { type: "string", minLength: 1, maxLength: MAX_IDEMPOTENCY_KEY_LENGTH, nullable: true },
  },
};

class RequestError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

type StripeEventPayload = {
  id: string;
  type: string;
  created?: number;
  data?: {
    object?: Record<string, unknown>;
  };
};

function normalizeOptionalText(value: unknown, field: string, max: number): string {
  const trimmed = String(value || "").trim();
  if (trimmed.length > max) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be ${max} characters or less.`);
  }
  return trimmed;
}

function normalizeRequiredText(value: unknown, field: string, max: number): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} is required.`);
  }
  if (trimmed.length > max) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be ${max} characters or less.`);
  }
  return trimmed;
}

function parseBody<T>(event: APIGatewayProxyEventV2, schema?: JsonSchema): T {
  let parsed: unknown;
  try {
    parsed = parseJsonRequestBody(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request body must be valid JSON.";
    throw new RequestError(400, "INVALID_REQUEST", message);
  }

  if (schema) {
    const issues = validateSchema(schema, parsed, "body");
    if (issues.length) {
      throw new RequestError(400, "INVALID_REQUEST", issues[0]);
    }
  }

  return parsed as T;
}

function readRawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) {
    throw new RequestError(400, "INVALID_REQUEST", "Request body is required.");
  }

  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

function getHeader(event: APIGatewayProxyEventV2, headerName: string): string {
  const target = headerName.toLowerCase();
  const entries = Object.entries(event.headers || {});
  for (const [key, value] of entries) {
    if (String(key).toLowerCase() === target) {
      return String(value || "").trim();
    }
  }
  return "";
}

function extractIdempotencyKey(event: APIGatewayProxyEventV2, bodyKey?: unknown): string {
  const fromHeader = getHeader(event, "idempotency-key");
  const fromBody = String(bodyKey || "").trim();
  const value = fromHeader || fromBody;

  if (!value) {
    throw new RequestError(400, "INVALID_REQUEST", "Idempotency key is required.");
  }

  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `Idempotency key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or less.`,
    );
  }

  return value;
}

function parseBookingId(value: unknown): string {
  return normalizeRequiredText(value, "bookingId", 80);
}

function parseStripeSignatureHeader(rawHeader: string): { timestamp: number; signatures: string[] } {
  if (!rawHeader) {
    throw new RequestError(401, "INVALID_SIGNATURE", "Stripe signature header is required.");
  }

  const parts = rawHeader.split(",").map((item) => item.trim());
  let timestamp = 0;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (!key || !value) {
      continue;
    }

    if (key === "t") {
      timestamp = Number(value);
      continue;
    }

    if (key === "v1") {
      signatures.push(value);
    }
  }

  if (!Number.isFinite(timestamp) || timestamp <= 0 || !signatures.length) {
    throw new RequestError(401, "INVALID_SIGNATURE", "Stripe signature header format is invalid.");
  }

  return {
    timestamp,
    signatures,
  };
}

function verifyStripeSignature(args: {
  rawPayload: string;
  signatureHeader: string;
  webhookSecret: string;
}): void {
  const webhookSecret = String(args.webhookSecret || "").trim();
  if (!webhookSecret) {
    throw new RequestError(500, "MISCONFIGURED", "Stripe webhook secret is not configured.");
  }

  const parsed = parseStripeSignatureHeader(args.signatureHeader);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const age = Math.abs(nowSeconds - parsed.timestamp);

  if (age > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new RequestError(401, "INVALID_SIGNATURE", "Stripe signature timestamp is outside tolerance.");
  }

  const signedPayload = `${parsed.timestamp}.${args.rawPayload}`;
  const expected = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  const matched = parsed.signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "utf8");
    if (candidateBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(candidateBuffer, expectedBuffer);
  });

  if (!matched) {
    throw new RequestError(401, "INVALID_SIGNATURE", "Stripe signature verification failed.");
  }
}

function parseStripeEvent(rawBody: string): StripeEventPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (_) {
    throw new RequestError(400, "INVALID_REQUEST", "Webhook body must be valid JSON.");
  }

  const payload = parsed as StripeEventPayload;
  const id = String(payload.id || "").trim();
  const type = String(payload.type || "").trim();

  if (!id || !type) {
    throw new RequestError(400, "INVALID_REQUEST", "Webhook event must include id and type.");
  }

  return payload;
}

function extractBookingIdFromStripeObject(object: Record<string, unknown>): string | null {
  const metadata = (object.metadata || {}) as Record<string, unknown>;

  const candidates = [
    metadata.bookingId,
    metadata.booking_id,
    object.client_reference_id,
    object.bookingId,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function extractAmountFromStripeObject(object: Record<string, unknown>, fallback: number): number {
  const candidates = [object.amount_total, object.amount_received, object.amount];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round((numeric / 100) * 100) / 100;
    }
  }

  return fallback;
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function emitNotification(
  repository: PaymentsWorkspaceRepository,
  args: {
    ownerRole: NotificationOwnerRole;
    ownerId: string;
    type: string;
    title: string;
    detail: string;
    createdBy: string;
  },
): Promise<void> {
  const meta = createRecordMeta({
    id: `n_${randomUUID()}`,
    createdBy: args.createdBy,
  });

  const notification: NotificationRecord = {
    ...meta,
    ownerId: args.ownerId,
    ownerRole: args.ownerRole,
    ownerReadKey: ownerReadKey(args.ownerId, false),
    type: args.type,
    title: args.title,
    detail: args.detail,
    read: false,
  };

  await repository.createNotification(notification);
}

function assertBookingOwnership(args: {
  booking: BookingRecord;
  requesterUserId: string | null;
  isAdmin: boolean;
}): void {
  if (args.isAdmin) {
    return;
  }

  if (!args.requesterUserId || args.booking.userId !== args.requesterUserId) {
    throw new RequestError(403, "FORBIDDEN", "You do not have permission for this booking.");
  }
}

async function applyBookingStatusChange(
  repository: PaymentsWorkspaceRepository,
  args: {
    booking: BookingRecord;
    to: BookingRecord["status"];
    by: string;
    note: string;
  },
): Promise<BookingRecord> {
  const booking = args.booking;

  if (booking.status === args.to) {
    return booking;
  }

  if (!canTransitionBookingStatus(booking.status, args.to)) {
    throw new RequestError(
      409,
      "INVALID_STATE",
      `Cannot transition booking from ${booking.status} to ${args.to}.`,
    );
  }

  const updated = touchRecordMeta(
    {
      ...booking,
      status: args.to,
      history: [
        ...booking.history,
        {
          at: new Date().toISOString(),
          by: args.by,
          from: booking.status,
          to: args.to,
          note: args.note,
        },
      ],
    },
    args.by,
  );

  await repository.updateBooking(updated);
  return updated;
}

async function handleCheckoutSession(
  event: APIGatewayProxyEventV2,
  repository: PaymentsWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
  requireAnyRole(identity, ["user", "admin"]);

  const payload = parseBody<{
    bookingId?: unknown;
    successUrl?: unknown;
    cancelUrl?: unknown;
    idempotencyKey?: unknown;
  }>(event, CHECKOUT_SESSION_SCHEMA);

  const idempotencyKey = extractIdempotencyKey(event, payload.idempotencyKey);
  const existing = await repository.getCheckoutSessionByIdempotencyKey(idempotencyKey);
  if (existing) {
    auditLog({
      action: "payments.checkout_session.reused",
      actorId: identity.sub,
      actorRoles: identity.roles,
      resourceType: "checkout_session",
      resourceId: existing.sessionId,
      outcome: "success",
      metadata: {
        bookingId: existing.bookingId,
        idempotencyKey,
      },
    });
    return json(200, success({ ...existing, reused: true }));
  }

  const bookingId = parseBookingId(payload.bookingId);
  const booking = await repository.getBookingById(bookingId);

  if (!booking) {
    return json(404, failure("NOT_FOUND", "Booking not found."));
  }

  const isAdmin = identity.roles.includes("admin");
  const user = await repository.getUserByCognitoSub(identity.sub);
  assertBookingOwnership({
    booking,
    requesterUserId: user?.id || null,
    isAdmin,
  });

  if (!["confirmed", "payment_pending"].includes(booking.status)) {
    throw new RequestError(
      409,
      "INVALID_STATE",
      `Booking status must be confirmed or payment_pending before checkout (current: ${booking.status}).`,
    );
  }

  let paymentBooking = booking;
  if (booking.status === "confirmed") {
    paymentBooking = await applyBookingStatusChange(repository, {
      booking,
      to: "payment_pending",
      by: identity.sub,
      note: "Checkout session created.",
    });
  }

  const sessionId = `cs_${randomUUID().replace(/-/g, "")}`;
  const paymentIntentId = `pi_${randomUUID().replace(/-/g, "")}`;
  const successUrl = normalizeOptionalText(payload.successUrl, "successUrl", 500)
    || `https://example.com/payments/success?session_id=${sessionId}`;
  const cancelUrl = normalizeOptionalText(payload.cancelUrl, "cancelUrl", 500)
    || `https://example.com/payments/cancel?session_id=${sessionId}`;

  const snapshot = {
    idempotencyKey,
    bookingId: paymentBooking.id,
    sessionId,
    paymentIntentId,
    checkoutUrl: `${successUrl}&redirect_status=simulated`,
    amount: paymentBooking.budget,
    currency: "AUD",
    cancelUrl,
    createdAt: new Date().toISOString(),
  };

  await repository.putCheckoutSessionByIdempotencyKey(snapshot);

  await emitNotification(repository, {
    ownerRole: "user",
    ownerId: paymentBooking.userId,
    type: "payment_checkout_created",
    title: "Payment started",
    detail: "Checkout session is ready. Complete payment to confirm booking.",
    createdBy: identity.sub,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: paymentBooking.artistId,
    type: "payment_checkout_created",
    title: "Client initiated payment",
    detail: `Checkout session started for booking ${paymentBooking.id}.`,
    createdBy: identity.sub,
  });

  auditLog({
    action: "payments.checkout_session.create",
    actorId: identity.sub,
    actorRoles: identity.roles,
    resourceType: "checkout_session",
    resourceId: snapshot.sessionId,
    outcome: "success",
    metadata: {
      bookingId: snapshot.bookingId,
      idempotencyKey,
      amount: snapshot.amount,
      currency: snapshot.currency,
    },
  });

  return json(201, success(snapshot));
}

async function markInvoicesVoid(
  repository: PaymentsWorkspaceRepository,
  bookingId: string,
  identitySub: string,
): Promise<number> {
  const invoices = await repository.listInvoicesByBookingId(bookingId);
  let voidedCount = 0;

  for (const invoice of invoices) {
    if (invoice.status === "void") {
      continue;
    }

    const next: InvoiceRecord = touchRecordMeta(
      {
        ...invoice,
        status: "void",
      },
      identitySub,
    );

    await repository.patchInvoice(next);
    voidedCount += 1;
  }

  return voidedCount;
}

async function handleRefund(
  event: APIGatewayProxyEventV2,
  repository: PaymentsWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
  requireAnyRole(identity, ["user", "admin"]);

  const payload = parseBody<{
    bookingId?: unknown;
    reason?: unknown;
    idempotencyKey?: unknown;
  }>(event, REFUND_REQUEST_SCHEMA);

  const idempotencyKey = extractIdempotencyKey(event, payload.idempotencyKey);
  const existing = await repository.getRefundByIdempotencyKey(idempotencyKey);
  if (existing) {
    auditLog({
      action: "payments.refund.reused",
      actorId: identity.sub,
      actorRoles: identity.roles,
      resourceType: "refund",
      resourceId: existing.refundId,
      outcome: "success",
      metadata: {
        bookingId: existing.bookingId,
        idempotencyKey,
      },
    });
    return json(200, success({ ...existing, reused: true }));
  }

  const bookingId = parseBookingId(payload.bookingId);
  const booking = await repository.getBookingById(bookingId);
  if (!booking) {
    return json(404, failure("NOT_FOUND", "Booking not found."));
  }

  const isAdmin = identity.roles.includes("admin");
  const user = await repository.getUserByCognitoSub(identity.sub);

  assertBookingOwnership({
    booking,
    requesterUserId: user?.id || null,
    isAdmin,
  });

  if (!["paid", "completed", "cancelled"].includes(booking.status)) {
    throw new RequestError(
      409,
      "INVALID_STATE",
      `Refunds can only be requested for paid or completed bookings (current: ${booking.status}).`,
    );
  }

  const reason = normalizeOptionalText(payload.reason, "reason", MAX_REASON_LENGTH)
    || "Customer requested refund";

  let updatedBooking = booking;
  if (booking.status === "paid") {
    updatedBooking = await applyBookingStatusChange(repository, {
      booking,
      to: "cancelled",
      by: identity.sub,
      note: `Refund requested: ${reason}`,
    });
  }

  const voidedInvoices = await markInvoicesVoid(repository, updatedBooking.id, identity.sub);

  const payout: PayoutRecord = {
    ...createRecordMeta({
      id: `p_${randomUUID()}`,
      createdBy: identity.sub,
    }),
    artistId: updatedBooking.artistId,
    amount: -Math.abs(updatedBooking.budget),
    status: "processing",
    date: new Date().toISOString(),
  };

  await repository.createPayout(payout);

  const snapshot = {
    idempotencyKey,
    bookingId: updatedBooking.id,
    refundId: `re_${randomUUID().replace(/-/g, "")}`,
    status: "requested" as const,
    reason,
    createdAt: new Date().toISOString(),
  };

  await repository.putRefundByIdempotencyKey(snapshot);

  await emitNotification(repository, {
    ownerRole: "user",
    ownerId: updatedBooking.userId,
    type: "refund_requested",
    title: "Refund requested",
    detail: `Refund submitted for booking ${updatedBooking.id}.`,
    createdBy: identity.sub,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: updatedBooking.artistId,
    type: "refund_requested",
    title: "Refund requested by client",
    detail: `Refund flow started for booking ${updatedBooking.id}.`,
    createdBy: identity.sub,
  });

  auditLog({
    action: "payments.refund.create",
    actorId: identity.sub,
    actorRoles: identity.roles,
    resourceType: "refund",
    resourceId: snapshot.refundId,
    outcome: "success",
    metadata: {
      bookingId: snapshot.bookingId,
      idempotencyKey,
      reason: snapshot.reason,
      voidedInvoices,
    },
  });

  return json(201, success({ ...snapshot, voidedInvoices }));
}

async function applyPaymentSucceeded(
  repository: PaymentsWorkspaceRepository,
  eventPayload: StripeEventPayload,
): Promise<{ bookingId: string }> {
  const object = (eventPayload.data?.object || {}) as Record<string, unknown>;
  const bookingId = extractBookingIdFromStripeObject(object);
  if (!bookingId) {
    throw new RequestError(400, "INVALID_REQUEST", "Stripe event is missing booking reference.");
  }

  const booking = await repository.getBookingById(bookingId);
  if (!booking) {
    throw new RequestError(404, "NOT_FOUND", "Booking not found for Stripe event.");
  }

  let updatedBooking = booking;
  if (!["paid", "completed"].includes(booking.status)) {
    updatedBooking = await applyBookingStatusChange(repository, {
      booking,
      to: "paid",
      by: `stripe:${eventPayload.id}`,
      note: `Stripe event ${eventPayload.type}`,
    });
  }

  const amount = extractAmountFromStripeObject(object, updatedBooking.budget);

  const invoice: InvoiceRecord = {
    ...createRecordMeta({
      id: `inv_${randomUUID()}`,
      createdBy: `stripe:${eventPayload.id}`,
    }),
    bookingId: updatedBooking.id,
    userId: updatedBooking.userId,
    artistId: updatedBooking.artistId,
    amount,
    status: "paid",
  };
  await repository.createInvoice(invoice);

  const payout: PayoutRecord = {
    ...createRecordMeta({
      id: `p_${randomUUID()}`,
      createdBy: `stripe:${eventPayload.id}`,
    }),
    artistId: updatedBooking.artistId,
    amount: Math.round(amount * 0.85 * 100) / 100,
    status: "scheduled",
    date: addDaysIso(7),
  };
  await repository.createPayout(payout);

  await emitNotification(repository, {
    ownerRole: "user",
    ownerId: updatedBooking.userId,
    type: "payment_succeeded",
    title: "Payment received",
    detail: `Booking ${updatedBooking.id} has been paid successfully.`,
    createdBy: `stripe:${eventPayload.id}`,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: updatedBooking.artistId,
    type: "payment_succeeded",
    title: "Payment confirmed",
    detail: `Payment is confirmed for booking ${updatedBooking.id}.`,
    createdBy: `stripe:${eventPayload.id}`,
  });

  auditLog({
    action: "payments.webhook.payment_succeeded",
    actorId: `stripe:${eventPayload.id}`,
    actorRoles: ["system"],
    resourceType: "booking",
    resourceId: updatedBooking.id,
    outcome: "success",
    metadata: {
      eventType: eventPayload.type,
      amount,
      invoiceId: invoice.id,
      payoutId: payout.id,
    },
  });

  return {
    bookingId: updatedBooking.id,
  };
}

async function applyPaymentFailed(
  repository: PaymentsWorkspaceRepository,
  eventPayload: StripeEventPayload,
): Promise<{ bookingId: string } | null> {
  const object = (eventPayload.data?.object || {}) as Record<string, unknown>;
  const bookingId = extractBookingIdFromStripeObject(object);
  if (!bookingId) {
    return null;
  }

  const booking = await repository.getBookingById(bookingId);
  if (!booking) {
    return null;
  }

  let updatedBooking = booking;
  if (["payment_pending", "confirmed"].includes(booking.status)) {
    updatedBooking = await applyBookingStatusChange(repository, {
      booking,
      to: "cancelled",
      by: `stripe:${eventPayload.id}`,
      note: `Stripe payment failed (${eventPayload.type}).`,
    });
  }

  await emitNotification(repository, {
    ownerRole: "user",
    ownerId: updatedBooking.userId,
    type: "payment_failed",
    title: "Payment failed",
    detail: `Payment failed for booking ${updatedBooking.id}. Please retry.`,
    createdBy: `stripe:${eventPayload.id}`,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: updatedBooking.artistId,
    type: "payment_failed",
    title: "Payment failed",
    detail: `Client payment failed for booking ${updatedBooking.id}.`,
    createdBy: `stripe:${eventPayload.id}`,
  });

  auditLog({
    action: "payments.webhook.payment_failed",
    actorId: `stripe:${eventPayload.id}`,
    actorRoles: ["system"],
    resourceType: "booking",
    resourceId: updatedBooking.id,
    outcome: "success",
    metadata: {
      eventType: eventPayload.type,
      status: updatedBooking.status,
    },
  });

  return {
    bookingId: updatedBooking.id,
  };
}

async function applyChargeRefunded(
  repository: PaymentsWorkspaceRepository,
  eventPayload: StripeEventPayload,
): Promise<{ bookingId: string } | null> {
  const object = (eventPayload.data?.object || {}) as Record<string, unknown>;
  const bookingId = extractBookingIdFromStripeObject(object);
  if (!bookingId) {
    return null;
  }

  const booking = await repository.getBookingById(bookingId);
  if (!booking) {
    return null;
  }

  let updatedBooking = booking;
  if (booking.status === "paid" && canTransitionBookingStatus(booking.status, "cancelled")) {
    updatedBooking = await applyBookingStatusChange(repository, {
      booking,
      to: "cancelled",
      by: `stripe:${eventPayload.id}`,
      note: `Stripe refund event (${eventPayload.type}).`,
    });
  }

  await markInvoicesVoid(repository, updatedBooking.id, `stripe:${eventPayload.id}`);

  const payout: PayoutRecord = {
    ...createRecordMeta({
      id: `p_${randomUUID()}`,
      createdBy: `stripe:${eventPayload.id}`,
    }),
    artistId: updatedBooking.artistId,
    amount: -Math.abs(updatedBooking.budget),
    status: "processing",
    date: new Date().toISOString(),
  };
  await repository.createPayout(payout);

  await emitNotification(repository, {
    ownerRole: "user",
    ownerId: updatedBooking.userId,
    type: "payment_refunded",
    title: "Refund processed",
    detail: `Refund processed for booking ${updatedBooking.id}.`,
    createdBy: `stripe:${eventPayload.id}`,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: updatedBooking.artistId,
    type: "payment_refunded",
    title: "Charge refunded",
    detail: `Charge refunded for booking ${updatedBooking.id}.`,
    createdBy: `stripe:${eventPayload.id}`,
  });

  auditLog({
    action: "payments.webhook.charge_refunded",
    actorId: `stripe:${eventPayload.id}`,
    actorRoles: ["system"],
    resourceType: "booking",
    resourceId: updatedBooking.id,
    outcome: "success",
    metadata: {
      eventType: eventPayload.type,
      status: updatedBooking.status,
      payoutId: payout.id,
    },
  });

  return {
    bookingId: updatedBooking.id,
  };
}

async function handleStripeWebhook(
  event: APIGatewayProxyEventV2,
  repository: PaymentsWorkspaceRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const rawBody = readRawBody(event);
  const signatureHeader = getHeader(event, "stripe-signature");
  const secret = await repository.getStripeWebhookSigningSecret();

  verifyStripeSignature({
    rawPayload: rawBody,
    signatureHeader,
    webhookSecret: secret,
  });

  const stripeEvent = parseStripeEvent(rawBody);

  const existing = await repository.getProcessedWebhookEvent(stripeEvent.id);
  if (existing) {
    auditLog({
      action: "payments.webhook.duplicate",
      actorId: `stripe:${stripeEvent.id}`,
      actorRoles: ["system"],
      resourceType: "webhook_event",
      resourceId: stripeEvent.id,
      outcome: "success",
      metadata: {
        eventType: stripeEvent.type,
        previousOutcome: existing.outcome,
      },
    });

    return json(
      200,
      success({
        received: true,
        duplicate: true,
        eventId: stripeEvent.id,
        outcome: existing.outcome,
      }),
    );
  }

  let outcome: "processed" | "ignored" | "failed" = "ignored";
  let bookingId: string | null = null;

  if (stripeEvent.type === "checkout.session.completed" || stripeEvent.type === "payment_intent.succeeded") {
    const result = await applyPaymentSucceeded(repository, stripeEvent);
    bookingId = result.bookingId;
    outcome = "processed";
  } else if (
    stripeEvent.type === "payment_intent.payment_failed"
    || stripeEvent.type === "checkout.session.expired"
  ) {
    const result = await applyPaymentFailed(repository, stripeEvent);
    bookingId = result?.bookingId || null;
    outcome = result ? "processed" : "ignored";
  } else if (stripeEvent.type === "charge.refunded" || stripeEvent.type === "payment_intent.canceled") {
    const result = await applyChargeRefunded(repository, stripeEvent);
    bookingId = result?.bookingId || null;
    outcome = result ? "processed" : "ignored";
  }

  await repository.putProcessedWebhookEvent({
    eventId: stripeEvent.id,
    type: stripeEvent.type,
    processedAt: new Date().toISOString(),
    outcome,
  });

  auditLog({
    action: "payments.webhook.process",
    actorId: `stripe:${stripeEvent.id}`,
    actorRoles: ["system"],
    resourceType: "webhook_event",
    resourceId: stripeEvent.id,
    outcome: "success",
    metadata: {
      eventType: stripeEvent.type,
      outcome,
      bookingId,
    },
  });

  return json(
    200,
    success({
      received: true,
      eventId: stripeEvent.id,
      outcome,
      bookingId,
    }),
  );
}

export function createPaymentsApiHandler(
  repository: PaymentsWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository = new NoopRoleAssignmentsRepository(),
) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      enforceRequestSecurity(event, { requireBearerForMutations: true });
      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      if (method === "POST" && path === "/v1/payments/checkout-session") {
        return await handleCheckoutSession(event, repository, roleAssignmentsRepository);
      }

      if (method === "POST" && path === "/v1/payments/refunds") {
        return await handleRefund(event, repository, roleAssignmentsRepository);
      }

      return json(404, failure("NOT_FOUND", "Route not found."));
    } catch (error) {
      if (error instanceof RequestError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      if (error instanceof SecurityPolicyError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      if (error instanceof Error && /Authentication is required/.test(error.message)) {
        return json(401, failure("UNAUTHENTICATED", error.message));
      }

      if (error instanceof Error && /permission/i.test(error.message)) {
        return json(403, failure("FORBIDDEN", error.message));
      }

      return json(500, failure("INTERNAL_ERROR", "Unexpected server error."));
    }
  };
}

export function createWebhookApiHandler(repository: PaymentsWorkspaceRepository) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      enforceRequestSecurity(event, { requireBearerForMutations: false });
      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      if (method === "POST" && path === "/v1/webhooks/stripe") {
        return await handleStripeWebhook(event, repository);
      }

      return json(404, failure("NOT_FOUND", "Route not found."));
    } catch (error) {
      if (error instanceof RequestError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      if (error instanceof SecurityPolicyError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      return json(500, failure("INTERNAL_ERROR", "Unexpected server error."));
    }
  };
}

export const handler = createPaymentsApiHandler(new NoopPaymentsWorkspaceRepository());
