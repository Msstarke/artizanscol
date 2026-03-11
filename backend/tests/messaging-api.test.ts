import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createMessagingApiHandler } from "../src/handlers/messaging-api.js";
import type {
  ArtistRecord,
  BookingRecord,
  MessageRecord,
  NotificationOwnerRole,
  NotificationRecord,
  UserRecord,
} from "../src/domain/entities.js";
import { createRecordMeta } from "../src/domain/record-meta.js";
import type { MessagingWorkspaceRepository } from "../src/repos/messaging-workspace.js";

class InMemoryMessagingRepo implements MessagingWorkspaceRepository {
  public users: UserRecord[] = [];
  public artists: ArtistRecord[] = [];
  public bookings: BookingRecord[] = [];
  public messages: MessageRecord[] = [];
  public notifications: NotificationRecord[] = [];

  async getUserByCognitoSub(cognitoSub: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.cognitoSub === cognitoSub) || null;
  }

  async getArtistByCognitoSub(cognitoSub: string): Promise<ArtistRecord | null> {
    return this.artists.find((artist) => artist.cognitoSub === cognitoSub) || null;
  }

  async listBookingsByUserId(userId: string): Promise<BookingRecord[]> {
    return this.bookings.filter((booking) => booking.userId === userId);
  }

  async listBookingsByArtistId(artistId: string): Promise<BookingRecord[]> {
    return this.bookings.filter((booking) => booking.artistId === artistId);
  }

  async listMessagesByParticipantId(participantId: string): Promise<MessageRecord[]> {
    return this.messages.filter(
      (message) => message.fromId === participantId || message.toId === participantId,
    );
  }

  async listMessagesByThreadId(threadId: string): Promise<MessageRecord[]> {
    return this.messages.filter((message) => message.threadId === threadId);
  }

  async createMessage(message: MessageRecord): Promise<void> {
    this.messages.push(message);
  }

  async listNotificationsByOwner(
    ownerRole: NotificationOwnerRole,
    ownerId: string,
  ): Promise<NotificationRecord[]> {
    return this.notifications.filter(
      (notification) => notification.ownerRole === ownerRole && notification.ownerId === ownerId,
    );
  }
}

function nowIso(day: number): string {
  return `2026-03-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

function makeEvent(args: {
  method: string;
  rawPath: string;
  body?: unknown;
  query?: Record<string, string>;
  pathParameters?: Record<string, string>;
  claims?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: args.rawPath,
    rawQueryString: "",
    headers: {},
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
    body: args.body == null ? undefined : JSON.stringify(args.body),
    queryStringParameters: args.query,
    pathParameters: args.pathParameters,
  } as APIGatewayProxyEventV2;
}

function baseRepo(): InMemoryMessagingRepo {
  const repo = new InMemoryMessagingRepo();

  repo.users = [
    {
      ...createRecordMeta({ id: "u1", createdBy: "seed", now: nowIso(1) }),
      cognitoSub: "sub-user-1",
      cognitoEmail: "user@example.com",
      name: "User One",
      email: "user@example.com",
      location: "Sydney",
      bio: "",
      emailVerified: true,
      profileCompleted: true,
      preferences: {
        bookingUpdates: true,
        messageAlerts: true,
        marketingEmails: false,
        browserNotifications: false,
      },
      setup: {
        status: "completed",
        currentStep: "done",
        artistOptIn: false,
        completedAt: nowIso(1),
      },
      savedArtistIds: [],
      bookingHistoryIds: ["b1"],
      deleted: false,
    },
  ];

  repo.artists = [
    {
      ...createRecordMeta({ id: "a1", createdBy: "seed", now: nowIso(1) }),
      cognitoSub: "sub-artist-1",
      cognitoEmail: "artist@example.com",
      name: "Artist One",
      handle: "artist-one",
      category: "Illustration",
      mediums: ["Digital"],
      location: "Melbourne",
      verified: true,
      popularity: 12,
      rating: 4.8,
      reviewCount: 15,
      priceFrom: 320,
      availability: "open",
      bio: "bio",
      profileVisible: true,
      profileViews: 0,
      completedBookings: 0,
      acceptanceRate: 0,
      portfolio: [],
    },
  ];

  repo.bookings = [
    {
      ...createRecordMeta({ id: "b1", createdBy: "sub-user-1", now: nowIso(2) }),
      userId: "u1",
      artistId: "a1",
      serviceId: "s1",
      budget: 500,
      deadline: "2030-01-01T00:00:00.000Z",
      message: "Need cover art",
      status: "requested",
      threadId: "t_u1_a1",
      history: [],
    },
  ];

  repo.messages = [
    {
      ...createRecordMeta({ id: "m1", createdBy: "u1", now: nowIso(3) }),
      threadId: "t_u1_a1",
      bookingId: "b1",
      fromId: "u1",
      toId: "a1",
      body: "Hello!",
      read: true,
    },
    {
      ...createRecordMeta({ id: "m2", createdBy: "a1", now: nowIso(4) }),
      threadId: "t_u1_a1",
      bookingId: "b1",
      fromId: "a1",
      toId: "u1",
      body: "Hi there",
      read: false,
    },
  ];

  repo.notifications = [
    {
      ...createRecordMeta({ id: "n1", createdBy: "seed", now: nowIso(5) }),
      ownerId: "u1",
      ownerRole: "user",
      ownerReadKey: "u1#unread",
      type: "booking_status",
      title: "Booking updated",
      detail: "Status changed",
      read: false,
    },
  ];

  return repo;
}

const userClaims = {
  sub: "sub-user-1",
  email: "user@example.com",
  "cognito:username": "user-one",
};

test("returns 401 when unauthenticated", async () => {
  const repo = baseRepo();
  const handler = createMessagingApiHandler(repo);

  const response = await handler(makeEvent({ method: "GET", rawPath: "/v1/threads" }));
  assert.equal(response.statusCode, 401);
});

test("GET /v1/threads returns participant thread list", async () => {
  const repo = baseRepo();
  const handler = createMessagingApiHandler(repo);

  const response = await handler(
    makeEvent({ method: "GET", rawPath: "/v1/threads", claims: userClaims }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.items.length, 1);
  assert.equal(parsed.data.items[0].id, "t_u1_a1");
  assert.equal(parsed.data.items[0].unreadCount, 1);
});

test("GET /v1/threads/{threadId}/messages blocks unauthorized thread access", async () => {
  const repo = baseRepo();
  const handler = createMessagingApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/threads/t_other/messages",
      pathParameters: { threadId: "t_other" },
      claims: userClaims,
    }),
  );

  assert.equal(response.statusCode, 403);
});

test("GET /v1/threads/{threadId}/messages returns paged messages", async () => {
  const repo = baseRepo();
  const handler = createMessagingApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/threads/t_u1_a1/messages",
      pathParameters: { threadId: "t_u1_a1" },
      query: { limit: "1" },
      claims: userClaims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.items.length, 1);
  assert.ok(parsed.data.pagination.nextCursor);
});

test("POST /v1/threads/{threadId}/messages creates a message", async () => {
  const repo = baseRepo();
  const handler = createMessagingApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/threads/t_u1_a1/messages",
      pathParameters: { threadId: "t_u1_a1" },
      claims: userClaims,
      body: {
        body: "Can we discuss timeline?",
      },
    }),
  );

  assert.equal(response.statusCode, 201);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.fromId, "u1");
  assert.equal(parsed.data.toId, "a1");
  assert.equal(repo.messages.length, 3);
});

test("POST /v1/threads/{threadId}/messages enforces anti-spam rate limit", async () => {
  const repo = baseRepo();
  const now = new Date();

  repo.messages = Array.from({ length: 5 }).map((_, index) => {
    const createdAt = new Date(now.getTime() - index * 5_000).toISOString();
    return {
      ...createRecordMeta({ id: `m_recent_${index}`, createdBy: "u1", now: createdAt }),
      threadId: "t_u1_a1",
      bookingId: "b1",
      fromId: "u1",
      toId: "a1",
      body: `msg-${index}`,
      read: false,
    };
  });

  const handler = createMessagingApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/threads/t_u1_a1/messages",
      pathParameters: { threadId: "t_u1_a1" },
      claims: userClaims,
      body: {
        body: "One more message",
      },
    }),
  );

  assert.equal(response.statusCode, 429);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.error.code, "RATE_LIMITED");
});

test("GET /v1/me/updates returns unread counts and deltas since timestamp", async () => {
  const repo = baseRepo();
  const handler = createMessagingApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/me/updates",
      claims: userClaims,
      query: {
        since: "2026-03-03T00:00:00.000Z",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.unread.messages, 1);
  assert.equal(parsed.data.unread.notifications, 1);
  assert.equal(parsed.data.bookingDeltas.length, 0);
  assert.equal(parsed.data.latestMessageSnippet.threadId, "t_u1_a1");
});

test("POST /v1/threads/{threadId}/messages rejects oversized payload", async () => {
  const repo = baseRepo();
  const handler = createMessagingApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/threads/t_u1_a1/messages",
      pathParameters: { threadId: "t_u1_a1" },
      claims: userClaims,
      body: {
        body: "x".repeat(17_000),
      },
    }),
  );

  assert.equal(response.statusCode, 413);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.error.code, "PAYLOAD_TOO_LARGE");
});
