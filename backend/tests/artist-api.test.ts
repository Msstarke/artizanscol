import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createArtistApiHandler } from "../src/handlers/artist-api.js";
import type {
  ArtistRecord,
  BookingRecord,
  MessageRecord,
  NotificationRecord,
  ServiceRecord,
} from "../src/domain/entities.js";
import { createRecordMeta } from "../src/domain/record-meta.js";
import type { ArtistWorkspaceRepository } from "../src/repos/artist-workspace.js";

class InMemoryArtistWorkspaceRepo implements ArtistWorkspaceRepository {
  public artists: ArtistRecord[] = [];
  public services: ServiceRecord[] = [];
  public bookings: BookingRecord[] = [];
  public messages: MessageRecord[] = [];
  public notifications: NotificationRecord[] = [];

  async getArtistByCognitoSub(cognitoSub: string): Promise<ArtistRecord | null> {
    return this.artists.find((artist) => artist.cognitoSub === cognitoSub) || null;
  }

  async patchArtist(artist: ArtistRecord): Promise<void> {
    const index = this.artists.findIndex((item) => item.id === artist.id);
    if (index >= 0) {
      this.artists[index] = artist;
      return;
    }
    this.artists.unshift(artist);
  }

  async listServicesByArtistId(artistId: string): Promise<ServiceRecord[]> {
    return this.services.filter((service) => service.artistId === artistId);
  }

  async getServiceById(serviceId: string): Promise<ServiceRecord | null> {
    return this.services.find((service) => service.id === serviceId) || null;
  }

  async createService(service: ServiceRecord): Promise<void> {
    this.services.unshift(service);
  }

  async updateService(service: ServiceRecord): Promise<void> {
    this.services = this.services.map((item) => (item.id === service.id ? service : item));
  }

  async deleteService(serviceId: string): Promise<void> {
    this.services = this.services.filter((item) => item.id !== serviceId);
  }

  async listBookingsByArtistId(artistId: string): Promise<BookingRecord[]> {
    return this.bookings.filter((booking) => booking.artistId === artistId);
  }

  async getBookingById(bookingId: string): Promise<BookingRecord | null> {
    return this.bookings.find((booking) => booking.id === bookingId) || null;
  }

  async updateBooking(booking: BookingRecord): Promise<void> {
    this.bookings = this.bookings.map((item) => (item.id === booking.id ? booking : item));
  }

  async listMessagesByParticipantId(participantId: string): Promise<MessageRecord[]> {
    return this.messages.filter(
      (message) => message.fromId === participantId || message.toId === participantId,
    );
  }

  async listNotificationsByOwner(ownerRole: "user" | "artist" | "admin", ownerId: string): Promise<NotificationRecord[]> {
    return this.notifications.filter(
      (notification) => notification.ownerRole === ownerRole && notification.ownerId === ownerId,
    );
  }

  async createNotification(notification: NotificationRecord): Promise<void> {
    this.notifications.unshift(notification);
  }

  async markNotificationsRead(ownerRole: "user" | "artist" | "admin", ownerId: string): Promise<number> {
    let count = 0;
    this.notifications = this.notifications.map((notification) => {
      if (notification.ownerRole === ownerRole && notification.ownerId === ownerId && !notification.read) {
        count += 1;
        return {
          ...notification,
          read: true,
          ownerReadKey: `${ownerId}#read`,
        };
      }
      return notification;
    });
    return count;
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

function baseRepo(): InMemoryArtistWorkspaceRepo {
  const repo = new InMemoryArtistWorkspaceRepo();

  const artistMeta = createRecordMeta({ id: "a1", createdBy: "seed", now: nowIso(1) });
  const otherArtistMeta = createRecordMeta({ id: "a2", createdBy: "seed", now: nowIso(1) });
  const serviceMeta = createRecordMeta({ id: "s1", createdBy: "seed", now: nowIso(1) });
  const bookingOneMeta = createRecordMeta({ id: "b1", createdBy: "sub-user-1", now: nowIso(2) });
  const bookingTwoMeta = createRecordMeta({ id: "b2", createdBy: "sub-user-2", now: nowIso(3) });
  const bookingThreeMeta = createRecordMeta({ id: "b3", createdBy: "sub-user-2", now: nowIso(4) });
  const messageMeta = createRecordMeta({ id: "m1", createdBy: "u1", now: nowIso(5) });

  repo.artists = [
    {
      ...artistMeta,
      cognitoSub: "sub-artist-1",
      cognitoEmail: "artist@example.com",
      name: "Artist One",
      handle: "artist-one",
      category: "Illustration",
      mediums: ["Digital", "Ink"],
      location: "Melbourne",
      verified: true,
      popularity: 31,
      rating: 4.9,
      reviewCount: 44,
      priceFrom: 280,
      availability: "open",
      bio: "Original character illustrator",
      profileVisible: true,
      profileViews: 123,
      completedBookings: 12,
      acceptanceRate: 87,
      portfolio: [],
    },
    {
      ...otherArtistMeta,
      cognitoSub: "sub-artist-2",
      cognitoEmail: "other@example.com",
      name: "Artist Two",
      handle: "artist-two",
      category: "Painting",
      mediums: ["Oil"],
      location: "Sydney",
      verified: false,
      popularity: 7,
      rating: 4.2,
      reviewCount: 8,
      priceFrom: 500,
      availability: "limited",
      bio: "Landscape painter",
      profileVisible: false,
      profileViews: 19,
      completedBookings: 2,
      acceptanceRate: 60,
      portfolio: [],
    },
  ];

  repo.services = [
    {
      ...serviceMeta,
      artistId: "a1",
      title: "Concept Art",
      description: "Detailed concept work",
      price: 350,
      deliveryDays: 10,
    },
  ];

  repo.bookings = [
    {
      ...bookingOneMeta,
      userId: "u1",
      artistId: "a1",
      serviceId: "s1",
      budget: 400,
      deadline: "2030-02-01T00:00:00.000Z",
      message: "Need album cover",
      status: "requested",
      threadId: "t_u1_a1",
      history: [],
    },
    {
      ...bookingTwoMeta,
      userId: "u2",
      artistId: "a1",
      serviceId: "s1",
      budget: 900,
      deadline: "2030-03-01T00:00:00.000Z",
      message: "Need mural sketch",
      status: "paid",
      threadId: "t_u2_a1",
      history: [],
    },
    {
      ...bookingThreeMeta,
      userId: "u2",
      artistId: "a1",
      serviceId: "s1",
      budget: 760,
      deadline: "2030-04-01T00:00:00.000Z",
      message: "Need animation frame",
      status: "completed",
      threadId: "t_u2_a1",
      history: [],
    },
  ];

  repo.messages = [
    {
      ...messageMeta,
      threadId: "t_u1_a1",
      bookingId: "b1",
      fromId: "u1",
      toId: "a1",
      body: "Hi!",
      read: false,
    },
    {
      ...createRecordMeta({ id: "m2", createdBy: "a1", now: nowIso(5) }),
      threadId: "t_u1_a1",
      bookingId: "b1",
      fromId: "a1",
      toId: "u1",
      body: "Thanks",
      read: true,
    },
    {
      ...createRecordMeta({ id: "m3", createdBy: "u2", now: nowIso(6) }),
      threadId: "t_u2_a1",
      bookingId: "b2",
      fromId: "u2",
      toId: "a1",
      body: "Ping",
      read: true,
    },
  ];

  repo.notifications = [
    {
      ...createRecordMeta({ id: "n1", createdBy: "seed", now: nowIso(6) }),
      ownerId: "a1",
      ownerRole: "artist",
      ownerReadKey: "a1#unread",
      type: "booking_created",
      title: "New request",
      detail: "A new booking request came in.",
      read: false,
    },
    {
      ...createRecordMeta({ id: "n2", createdBy: "seed", now: nowIso(5) }),
      ownerId: "a1",
      ownerRole: "artist",
      ownerReadKey: "a1#read",
      type: "booking_status",
      title: "Status updated",
      detail: "Booking moved to paid.",
      read: true,
    },
  ];

  return repo;
}

const claims = {
  sub: "sub-artist-1",
  email: "artist@example.com",
  "cognito:username": "artist-one",
};

test("returns 401 when unauthenticated", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(makeEvent({ method: "GET", rawPath: "/v1/artist/me" }));
  assert.equal(response.statusCode, 401);
});

test("GET /v1/artist/me returns profile summary", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artist/me",
      claims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.id, "a1");
  assert.equal(parsed.data.serviceCount, 1);
});

test("GET /v1/artist/me provisions a readable name when cognito username is opaque", async () => {
  const repo = baseRepo();
  repo.artists = [];
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artist/me",
      claims: {
        sub: "sub-new-artist",
        email: "matthew@example.com",
        "cognito:username": "794ee4e8-0061-70ab-595b-274a71206fcd",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.name, "Matthew");
});

test("PATCH /v1/artist/me/profile updates editable fields", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: "/v1/artist/me/profile",
      claims,
      body: {
        name: "Artist One Updated",
        handle: "artist-one-updated",
        location: "Brisbane",
        bio: "Updated bio",
        availability: "limited",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.name, "Artist One Updated");
  assert.equal(repo.artists[0].availability, "limited");
});

test("PATCH /v1/artist/me/profile accepts empty optional location", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: "/v1/artist/me/profile",
      claims,
      body: {
        profileVisible: true,
        location: "",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.profileVisible, true);
  assert.equal(parsed.data.location, "");
});

test("PATCH /v1/artist/me/profile saves incomplete edits as a draft and turns visibility off", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: "/v1/artist/me/profile",
      claims,
      body: {
        priceFrom: 0,
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.profileVisible, false);
  assert.equal(parsed.data.publishState, "draft");
  assert.deepEqual(parsed.data.publishMissingFields, ["Starting budget"]);
});

test("PATCH /v1/artist/me/profile rejects publishing an incomplete draft", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: "/v1/artist/me/profile",
      claims,
      body: {
        priceFrom: 0,
        profileVisible: true,
      },
    }),
  );

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error.message, /Starting budget/);
});

test("PUT /v1/artist/me/onboarding stores onboarding fields", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "PUT",
      rawPath: "/v1/artist/me/onboarding",
      claims,
      body: {
        category: "Concept Art",
        mediums: ["Digital Painting", "3D"],
        priceFrom: 450,
        availability: "open",
        portfolio: [
          {
            title: "Project One",
            medium: "Digital Painting",
            imageUrl: "https://cdn.example.com/project-one.jpg",
          },
        ],
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.category, "Concept Art");
  assert.equal(parsed.data.portfolio.length, 1);
});

test("service create, update, delete endpoints work for artist", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const createResponse = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/artist/me/services",
      claims,
      body: {
        title: "Storyboard Pack",
        description: "10-frame storyboard",
        price: 600,
        deliveryDays: 14,
      },
    }),
  );

  assert.equal(createResponse.statusCode, 201);
  const created = JSON.parse(String(createResponse.body));
  const serviceId = String(created.data.id);
  assert.ok(serviceId.startsWith("s_"));

  const updateResponse = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: `/v1/artist/me/services/${serviceId}`,
      pathParameters: { serviceId },
      claims,
      body: {
        price: 650,
      },
    }),
  );

  assert.equal(updateResponse.statusCode, 200);
  const updated = JSON.parse(String(updateResponse.body));
  assert.equal(updated.data.price, 650);

  const deleteResponse = await handler(
    makeEvent({
      method: "DELETE",
      rawPath: `/v1/artist/me/services/${serviceId}`,
      pathParameters: { serviceId },
      claims,
    }),
  );

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(repo.services.some((item) => item.id === serviceId), false);
});

test("GET /v1/artist/me/bookings returns grouped booking counters", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artist/me/bookings",
      claims,
      query: {
        limit: "2",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.items.length, 2);
  assert.equal(parsed.data.grouped.incoming, 1);
});

test("POST /v1/artist/me/bookings/{id}/accept enforces transition rules", async () => {
  const repo = baseRepo();
  repo.bookings[0] = {
    ...repo.bookings[0],
    status: "completed",
  };
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/artist/me/bookings/b1/accept",
      pathParameters: {
        bookingId: "b1",
        action: "accept",
      },
      claims,
      body: {},
    }),
  );

  assert.equal(response.statusCode, 400);
});

test("POST /v1/artist/me/bookings/{id}/decline updates status and emits notifications", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/artist/me/bookings/b1/decline",
      pathParameters: {
        bookingId: "b1",
        action: "decline",
      },
      claims,
      body: {
        note: "Timing does not fit current availability",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.status, "declined");
  assert.equal(repo.notifications.length, 4);
});

test("GET /v1/artist/me/earnings derives totals from paid/completed bookings", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artist/me/earnings",
      claims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.grossRevenue, 1660);
  assert.equal(parsed.data.paidOrCompletedCount, 2);
});

test("GET /v1/artist/me/analytics computes booking and messaging metrics", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artist/me/analytics",
      claims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.bookingPerformance.total, 3);
  assert.equal(parsed.data.messaging.messageCount, 3);
  assert.equal(parsed.data.messaging.threadCount, 2);
});

test("artist notifications list and read-all are persisted server-side", async () => {
  const repo = baseRepo();
  const handler = createArtistApiHandler(repo);

  const listResponse = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artist/me/notifications",
      claims,
    }),
  );

  assert.equal(listResponse.statusCode, 200);
  const listed = JSON.parse(String(listResponse.body));
  assert.equal(listed.data.items.length, 2);
  assert.equal(listed.data.unreadCount, 1);

  const markResponse = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/artist/me/notifications/read-all",
      claims,
      body: {},
    }),
  );

  assert.equal(markResponse.statusCode, 200);
  const marked = JSON.parse(String(markResponse.body));
  assert.equal(marked.data.updatedCount, 1);
  assert.equal(repo.notifications.filter((item) => !item.read).length, 0);
});
