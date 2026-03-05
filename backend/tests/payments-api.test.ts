import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createPaymentsApiHandler,
  createWebhookApiHandler,
} from "../src/handlers/payments-api.js";
import type {
  BookingRecord,
  InvoiceRecord,
  NotificationRecord,
  PayoutRecord,
  UserRecord,
} from "../src/domain/entities.js";
import { createRecordMeta } from "../src/domain/record-meta.js";
import type {
  CheckoutSessionSnapshot,
  PaymentsWorkspaceRepository,
  ProcessedWebhookEvent,
  RefundSnapshot,
} from "../src/repos/payments-workspace.js";

class InMemoryPaymentsRepo implements PaymentsWorkspaceRepository {
  public users: UserRecord[] = [];
  public bookings: BookingRecord[] = [];
  public invoices: InvoiceRecord[] = [];
  public payouts: PayoutRecord[] = [];
  public notifications: NotificationRecord[] = [];
  public checkoutByKey = new Map<string, CheckoutSessionSnapshot>();
  public refundsByKey = new Map<string, RefundSnapshot>();
  public webhookEvents = new Map<string, ProcessedWebhookEvent>();
  public webhookSecret = "whsec_test_secret";

  async getUserByCognitoSub(cognitoSub: string): Promise<UserRecord | null> {
    return this.users.find((item) => item.cognitoSub === cognitoSub) || null;
  }

  async getBookingById(bookingId: string): Promise<BookingRecord | null> {
    return this.bookings.find((item) => item.id === bookingId) || null;
  }

  async updateBooking(booking: BookingRecord): Promise<void> {
    this.bookings = this.bookings.map((item) => (item.id === booking.id ? booking : item));
  }

  async createInvoice(invoice: InvoiceRecord): Promise<void> {
    this.invoices.push(invoice);
  }

  async listInvoicesByBookingId(bookingId: string): Promise<InvoiceRecord[]> {
    return this.invoices.filter((item) => item.bookingId === bookingId);
  }

  async patchInvoice(invoice: InvoiceRecord): Promise<void> {
    this.invoices = this.invoices.map((item) => (item.id === invoice.id ? invoice : item));
  }

  async createPayout(payout: PayoutRecord): Promise<void> {
    this.payouts.push(payout);
  }

  async createNotification(notification: NotificationRecord): Promise<void> {
    this.notifications.push(notification);
  }

  async getCheckoutSessionByIdempotencyKey(key: string): Promise<CheckoutSessionSnapshot | null> {
    return this.checkoutByKey.get(key) || null;
  }

  async putCheckoutSessionByIdempotencyKey(snapshot: CheckoutSessionSnapshot): Promise<void> {
    this.checkoutByKey.set(snapshot.idempotencyKey, snapshot);
  }

  async getRefundByIdempotencyKey(key: string): Promise<RefundSnapshot | null> {
    return this.refundsByKey.get(key) || null;
  }

  async putRefundByIdempotencyKey(snapshot: RefundSnapshot): Promise<void> {
    this.refundsByKey.set(snapshot.idempotencyKey, snapshot);
  }

  async getProcessedWebhookEvent(eventId: string): Promise<ProcessedWebhookEvent | null> {
    return this.webhookEvents.get(eventId) || null;
  }

  async putProcessedWebhookEvent(event: ProcessedWebhookEvent): Promise<void> {
    this.webhookEvents.set(event.eventId, event);
  }

  async getStripeWebhookSigningSecret(): Promise<string> {
    return this.webhookSecret;
  }
}

function nowIso(day: number): string {
  return `2026-03-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

function makeEvent(args: {
  method: string;
  rawPath: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  pathParameters?: Record<string, string>;
  claims?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  const body = args.rawBody != null
    ? args.rawBody
    : args.body == null
      ? undefined
      : JSON.stringify(args.body);

  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: args.rawPath,
    rawQueryString: "",
    headers: args.headers || {},
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: "example.com",
      domainPrefix: "api",
      http: {
        method: args.method,
        path: args.rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      authorizer: args.claims
        ? {
            jwt: {
              claims: args.claims,
            },
          }
        : undefined,
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "",
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
    body,
    queryStringParameters: args.query,
    pathParameters: args.pathParameters,
  } as APIGatewayProxyEventV2;
}

function makeStripeSignature(rawBody: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function baseRepo(): InMemoryPaymentsRepo {
  const repo = new InMemoryPaymentsRepo();

  repo.users = [
    {
      ...createRecordMeta({ id: "u1", createdBy: "seed", now: nowIso(1) }),
      cognitoSub: "sub-user-1",
      cognitoEmail: "user@example.com",
      name: "User One",
      email: "user@example.com",
      location: "Sydney",
      emailVerified: true,
      profileCompleted: true,
      savedArtistIds: [],
      bookingHistoryIds: ["b1", "b2", "b3"],
      deleted: false,
    },
  ];

  repo.bookings = [
    {
      ...createRecordMeta({ id: "b1", createdBy: "sub-user-1", now: nowIso(2) }),
      userId: "u1",
      artistId: "a1",
      serviceId: "s1",
      budget: 650,
      deadline: "2030-01-01T00:00:00.000Z",
      message: "Need artwork",
      status: "confirmed",
      threadId: "t_u1_a1",
      history: [],
    },
    {
      ...createRecordMeta({ id: "b2", createdBy: "sub-user-1", now: nowIso(3) }),
      userId: "u1",
      artistId: "a1",
      serviceId: "s2",
      budget: 900,
      deadline: "2030-02-01T00:00:00.000Z",
      message: "Need branding",
      status: "paid",
      threadId: "t_u1_a1_2",
      history: [],
    },
    {
      ...createRecordMeta({ id: "b3", createdBy: "sub-user-1", now: nowIso(4) }),
      userId: "u1",
      artistId: "a1",
      serviceId: "s3",
      budget: 1200,
      deadline: "2030-03-01T00:00:00.000Z",
      message: "Need campaign",
      status: "paid",
      threadId: "t_u1_a1_3",
      history: [],
    },
  ];

  repo.invoices = [
    {
      ...createRecordMeta({ id: "inv_b2", createdBy: "seed", now: nowIso(3) }),
      bookingId: "b2",
      userId: "u1",
      artistId: "a1",
      amount: 900,
      status: "paid",
    },
    {
      ...createRecordMeta({ id: "inv_b3", createdBy: "seed", now: nowIso(4) }),
      bookingId: "b3",
      userId: "u1",
      artistId: "a1",
      amount: 1200,
      status: "paid",
    },
  ];

  return repo;
}

const userClaims = {
  sub: "sub-user-1",
  email: "user@example.com",
  "cognito:username": "user-one",
};

test("checkout requires authentication", async () => {
  const repo = baseRepo();
  const handler = createPaymentsApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/payments/checkout-session",
      body: { bookingId: "b1" },
      headers: { "idempotency-key": "idem-checkout-1" },
    }),
  );

  assert.equal(response.statusCode, 401);
});

test("checkout session creates payment_pending transition and is idempotent", async () => {
  const repo = baseRepo();
  const handler = createPaymentsApiHandler(repo);

  const first = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/payments/checkout-session",
      claims: userClaims,
      headers: { "idempotency-key": "idem-checkout-2" },
      body: {
        bookingId: "b1",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      },
    }),
  );

  assert.equal(first.statusCode, 201);
  const firstBody = JSON.parse(String(first.body));
  assert.ok(firstBody.data.sessionId.startsWith("cs_"));
  assert.equal(repo.bookings.find((item) => item.id === "b1")?.status, "payment_pending");
  assert.equal(repo.notifications.length, 2);

  const second = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/payments/checkout-session",
      claims: userClaims,
      headers: { "idempotency-key": "idem-checkout-2" },
      body: {
        bookingId: "b1",
      },
    }),
  );

  assert.equal(second.statusCode, 200);
  const secondBody = JSON.parse(String(second.body));
  assert.equal(secondBody.data.reused, true);
  assert.equal(repo.checkoutByKey.size, 1);
});

test("refund request voids invoice and creates payout reversal", async () => {
  const repo = baseRepo();
  const handler = createPaymentsApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/payments/refunds",
      claims: userClaims,
      headers: { "idempotency-key": "idem-refund-1" },
      body: {
        bookingId: "b2",
        reason: "Project cancelled",
      },
    }),
  );

  assert.equal(response.statusCode, 201);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.status, "requested");
  assert.equal(parsed.data.voidedInvoices, 1);
  assert.equal(repo.bookings.find((item) => item.id === "b2")?.status, "cancelled");
  assert.equal(repo.invoices.find((item) => item.id === "inv_b2")?.status, "void");
  assert.equal(repo.payouts.length, 1);
  assert.ok(repo.payouts[0].amount < 0);
});

test("webhook rejects invalid signature", async () => {
  const repo = baseRepo();
  const handler = createWebhookApiHandler(repo);

  const payload = JSON.stringify({
    id: "evt_invalid_sig",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "b1", amount_total: 65000 } },
  });

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/webhooks/stripe",
      rawBody: payload,
      headers: { "stripe-signature": "t=123,v1=invalid" },
    }),
  );

  assert.equal(response.statusCode, 401);
});

test("webhook payment success updates booking and creates financial records", async () => {
  const repo = baseRepo();
  repo.bookings = repo.bookings.map((item) => {
    if (item.id === "b1") {
      return {
        ...item,
        status: "payment_pending",
      };
    }
    return item;
  });

  const handler = createWebhookApiHandler(repo);

  const payload = JSON.stringify({
    id: "evt_success_1",
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: "b1",
        amount_total: 65000,
      },
    },
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = makeStripeSignature(payload, repo.webhookSecret, timestamp);

  const first = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/webhooks/stripe",
      rawBody: payload,
      headers: { "stripe-signature": signature },
    }),
  );

  assert.equal(first.statusCode, 200);
  const parsed = JSON.parse(String(first.body));
  assert.equal(parsed.data.outcome, "processed");

  assert.equal(repo.bookings.find((item) => item.id === "b1")?.status, "paid");
  assert.equal(repo.invoices.filter((item) => item.bookingId === "b1").length, 1);
  assert.equal(repo.payouts.length, 1);
  assert.equal(repo.notifications.length, 2);

  const second = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/webhooks/stripe",
      rawBody: payload,
      headers: { "stripe-signature": signature },
    }),
  );

  assert.equal(second.statusCode, 200);
  const secondBody = JSON.parse(String(second.body));
  assert.equal(secondBody.data.duplicate, true);
  assert.equal(repo.invoices.filter((item) => item.bookingId === "b1").length, 1);
});

test("webhook refund event voids invoices and creates reversal payout", async () => {
  const repo = baseRepo();
  const handler = createWebhookApiHandler(repo);

  const payload = JSON.stringify({
    id: "evt_refund_1",
    type: "charge.refunded",
    data: {
      object: {
        metadata: {
          bookingId: "b3",
        },
      },
    },
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = makeStripeSignature(payload, repo.webhookSecret, timestamp);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/webhooks/stripe",
      rawBody: payload,
      headers: { "stripe-signature": signature },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.outcome, "processed");
  assert.equal(repo.bookings.find((item) => item.id === "b3")?.status, "cancelled");
  assert.equal(repo.invoices.find((item) => item.id === "inv_b3")?.status, "void");
  assert.equal(repo.payouts.length, 1);
  assert.ok(repo.payouts[0].amount < 0);
});
