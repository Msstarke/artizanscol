import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createUserApiHandler } from "../src/handlers/user-api.js";
import type {
  ArtistRecord,
  BookingRecord,
  NotificationOwnerRole,
  NotificationRecord,
  ServiceRecord,
  UserRecord,
} from "../src/domain/entities.js";
import { createRecordMeta } from "../src/domain/record-meta.js";
import type { UserWorkspaceRepository } from "../src/repos/user-workspace.js";

class InMemoryUserWorkspaceRepo implements UserWorkspaceRepository {
  public users: UserRecord[] = [];
  public artists: ArtistRecord[] = [];
  public services: ServiceRecord[] = [];
  public bookings: BookingRecord[] = [];
  public notifications: NotificationRecord[] = [];

  async getUserByCognitoSub(cognitoSub: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.cognitoSub === cognitoSub) || null;
  }

  async patchUser(user: UserRecord): Promise<void> {
    const index = this.users.findIndex((item) => item.id === user.id);
    if (index >= 0) {
      this.users[index] = user;
      return;
    }
    this.users.unshift(user);
  }

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

  async getArtistById(artistId: string): Promise<ArtistRecord | null> {
    return this.artists.find((artist) => artist.id === artistId) || null;
  }

  async getServiceById(serviceId: string): Promise<ServiceRecord | null> {
    return this.services.find((service) => service.id === serviceId) || null;
  }

  async listArtistsByIds(artistIds: string[]): Promise<ArtistRecord[]> {
    const wanted = new Set(artistIds);
    return this.artists.filter((artist) => wanted.has(artist.id));
  }

  async saveArtistForUser(userId: string, artistId: string): Promise<UserRecord> {
    const user = this.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.savedArtistIds.includes(artistId)) {
      user.savedArtistIds.push(artistId);
    }
    return user;
  }

  async removeSavedArtistForUser(userId: string, artistId: string): Promise<UserRecord> {
    const user = this.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found");
    }

    user.savedArtistIds = user.savedArtistIds.filter((id) => id !== artistId);
    return user;
  }

  async listBookingsByUserId(userId: string): Promise<BookingRecord[]> {
    return this.bookings.filter((booking) => booking.userId === userId);
  }

  async getBookingById(bookingId: string): Promise<BookingRecord | null> {
    return this.bookings.find((booking) => booking.id === bookingId) || null;
  }

  async createBooking(booking: BookingRecord): Promise<void> {
    this.bookings.unshift(booking);
  }

  async updateBooking(booking: BookingRecord): Promise<void> {
    this.bookings = this.bookings.map((item) => (item.id === booking.id ? booking : item));
  }

  async listNotificationsByOwner(
    ownerRole: NotificationOwnerRole,
    ownerId: string,
  ): Promise<NotificationRecord[]> {
    return this.notifications.filter(
      (item) => item.ownerRole === ownerRole && item.ownerId === ownerId,
    );
  }

  async createNotification(notification: NotificationRecord): Promise<void> {
    this.notifications.unshift(notification);
  }

  async markNotificationsRead(ownerRole: NotificationOwnerRole, ownerId: string): Promise<number> {
    let count = 0;
    this.notifications = this.notifications.map((item) => {
      if (item.ownerRole === ownerRole && item.ownerId === ownerId && !item.read) {
        count += 1;
        return {
          ...item,
          read: true,
          ownerReadKey: `${ownerId}#read`,
        };
      }
      return item;
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

function baseRepo(): InMemoryUserWorkspaceRepo {
  const repo = new InMemoryUserWorkspaceRepo();

  const userMeta = createRecordMeta({ id: "u1", createdBy: "seed", now: nowIso(1) });
  const artistMeta = createRecordMeta({ id: "a1", createdBy: "seed", now: nowIso(1) });
  const serviceMeta = createRecordMeta({ id: "s1", createdBy: "seed", now: nowIso(1) });

  repo.users = [
    {
      ...userMeta,
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
      bookingHistoryIds: [],
      deleted: false,
    },
  ];

  repo.artists = [
    {
      ...artistMeta,
      cognitoSub: "sub-artist-1",
      cognitoEmail: "artist@example.com",
      name: "Artist One",
      handle: "artist-one",
      category: "Illustration",
      mediums: ["Digital"],
      location: "Melbourne",
      verified: true,
      popularity: 10,
      rating: 4.8,
      reviewCount: 12,
      priceFrom: 250,
      availability: "open",
      bio: "bio",
      profileVisible: true,
      profileViews: 0,
      completedBookings: 0,
      acceptanceRate: 0,
      portfolio: [],
    },
  ];

  repo.services = [
    {
      ...serviceMeta,
      artistId: "a1",
      title: "Logo Design",
      description: "desc",
      price: 250,
      deliveryDays: 7,
    },
  ];

  return repo;
}

const claims = {
  sub: "sub-user-1",
  email: "user@example.com",
  "cognito:username": "user-one",
};

test("returns 401 when unauthenticated", async () => {
  const repo = baseRepo();
  const handler = createUserApiHandler(repo);

  const response = await handler(makeEvent({ method: "GET", rawPath: "/v1/me" }));
  assert.equal(response.statusCode, 401);
});

test("GET /v1/me returns current profile", async () => {
  const repo = baseRepo();
  const handler = createUserApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/me",
      claims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.id, "u1");
});

test("GET /v1/me syncs the artist profile fields from the saved user profile", async () => {
  const repo = baseRepo();
  repo.users = [
    {
      ...repo.users[0],
      id: "u-sync",
      cognitoSub: "sub-shared",
      cognitoEmail: "matthew@example.com",
      email: "matthew@example.com",
      name: "Matthew Starke",
      location: "Sydney",
      bio: "Independent illustrator and designer.",
    },
  ];
  repo.artists = [
    {
      ...repo.artists[0],
      id: "a-sync",
      cognitoSub: "sub-shared",
      cognitoEmail: "matthew@example.com",
      name: "794ee4e8 0061 70ab 595b 274a71206fcd",
      location: "",
      bio: "",
    },
  ];

  const handler = createUserApiHandler(repo, undefined, repo);
  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/me",
      claims: {
        sub: "sub-shared",
        email: "matthew@example.com",
        "cognito:username": "794ee4e8 0061 70ab 595b 274a71206fcd",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(repo.artists[0].name, "Matthew Starke");
  assert.equal(repo.artists[0].location, "Sydney");
  assert.equal(repo.artists[0].bio, "Independent illustrator and designer.");
});

test("PATCH /v1/me/profile validates payload and updates profile", async () => {
  const repo = baseRepo();
  repo.users = [
    {
      ...repo.users[0],
      cognitoSub: "sub-user-1",
      name: "User One",
      location: "Sydney",
      bio: "",
    },
  ];
  repo.artists = [
    {
      ...repo.artists[0],
      cognitoSub: "sub-user-1",
      name: "Old Artist Name",
      location: "",
      bio: "",
    },
  ];
  const handler = createUserApiHandler(repo, undefined, repo);

  const response = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: "/v1/me/profile",
      claims,
      body: {
        name: "Updated Name",
        location: "Brisbane",
        bio: "Short bio",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.name, "Updated Name");
  assert.equal(repo.users[0].name, "Updated Name");
  assert.equal(repo.artists[0].name, "Updated Name");
  assert.equal(repo.artists[0].location, "Brisbane");
  assert.equal(repo.artists[0].bio, "Short bio");
});

test("GET /v1/me provisions a readable name when cognito username is opaque", async () => {
  const repo = baseRepo();
  repo.users = [];
  const handler = createUserApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/me",
      claims: {
        sub: "sub-new",
        email: "matthew@example.com",
        "cognito:username": "794ee4e8-0061-70ab-595b-274a71206fcd",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.name, "Matthew");
});

test("POST /v1/bookings validates required fields", async () => {
  const repo = baseRepo();
  const handler = createUserApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/bookings",
      claims,
      body: {
        serviceId: "",
      },
    }),
  );

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, false);
});

test("POST /v1/bookings creates booking and emits notifications", async () => {
  const repo = baseRepo();
  const handler = createUserApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/bookings",
      claims,
      body: {
        serviceId: "s1",
        deadline: "2030-01-01T00:00:00.000Z",
        budget: 300,
        message: "Need a logo package",
      },
    }),
  );

  assert.equal(response.statusCode, 201);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.equal(repo.bookings.length, 1);
  assert.equal(repo.notifications.length, 2);
});

test("POST /v1/bookings rejects self-booking", async () => {
  const repo = baseRepo();
  repo.artists = [
    {
      ...repo.artists[0],
      cognitoSub: "sub-user-1",
    },
  ];
  const handler = createUserApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/bookings",
      claims,
      body: {
        artistId: "a1",
        deadline: "2030-01-01T00:00:00.000Z",
        budget: 300,
        message: "Need a logo package",
      },
    }),
  );

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "INVALID_REQUEST");
  assert.equal(repo.bookings.length, 0);
  assert.equal(repo.notifications.length, 0);
});

test("POST /v1/bookings/{id}/status rejects invalid transitions", async () => {
  const repo = baseRepo();
  const bookingMeta = createRecordMeta({ id: "b1", createdBy: "sub-user-1", now: nowIso(2) });
  repo.bookings = [
    {
      ...bookingMeta,
      userId: "u1",
      artistId: "a1",
      serviceId: "s1",
      budget: 300,
      deadline: "2030-01-01T00:00:00.000Z",
      message: "Need a logo package",
      status: "requested",
      threadId: "t_u1_a1",
      history: [],
    },
  ];

  const handler = createUserApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/bookings/b1/status",
      pathParameters: { bookingId: "b1" },
      claims,
      body: {
        status: "paid",
      },
    }),
  );

  assert.equal(response.statusCode, 400);
});

test("POST /v1/bookings/{id}/status applies valid transition and emits notifications", async () => {
  const repo = baseRepo();
  const bookingMeta = createRecordMeta({ id: "b1", createdBy: "sub-user-1", now: nowIso(2) });
  repo.bookings = [
    {
      ...bookingMeta,
      userId: "u1",
      artistId: "a1",
      serviceId: "s1",
      budget: 300,
      deadline: "2030-01-01T00:00:00.000Z",
      message: "Need a logo package",
      status: "requested",
      threadId: "t_u1_a1",
      history: [],
    },
  ];

  const handler = createUserApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/bookings/b1/status",
      pathParameters: { bookingId: "b1" },
      claims,
      body: {
        status: "accepted",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.status, "accepted");
  assert.equal(repo.notifications.length, 2);
});

test("saved artist add/remove endpoints update counts", async () => {
  const repo = baseRepo();
  const handler = createUserApiHandler(repo);

  const addResponse = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/me/saved-artists/a1",
      pathParameters: { artistId: "a1" },
      claims,
    }),
  );
  assert.equal(addResponse.statusCode, 200);

  const listResponse = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/me/saved-artists",
      claims,
    }),
  );
  assert.equal(listResponse.statusCode, 200);
  const listParsed = JSON.parse(String(listResponse.body));
  assert.equal(listParsed.data.count, 1);

  const removeResponse = await handler(
    makeEvent({
      method: "DELETE",
      rawPath: "/v1/me/saved-artists/a1",
      pathParameters: { artistId: "a1" },
      claims,
    }),
  );
  assert.equal(removeResponse.statusCode, 200);
  assert.equal(repo.users[0].savedArtistIds.length, 0);
});

test("notifications read-all marks unread user notifications as read", async () => {
  const repo = baseRepo();
  const notificationMeta = createRecordMeta({ id: "n1", createdBy: "seed", now: nowIso(3) });
  repo.notifications = [
    {
      ...notificationMeta,
      ownerId: "u1",
      ownerRole: "user",
      ownerReadKey: "u1#unread",
      type: "booking_status",
      title: "title",
      detail: "detail",
      read: false,
    },
  ];

  const handler = createUserApiHandler(repo);
  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/me/notifications/read-all",
      claims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.updatedCount, 1);
  assert.equal(repo.notifications[0].read, true);
});
