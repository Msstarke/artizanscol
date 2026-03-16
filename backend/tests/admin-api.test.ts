import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createAdminApiHandler } from "../src/handlers/admin-api.js";
import type {
  ArtistRecord,
  CategoryRecord,
  ReportRecord,
  SystemConfigRecord,
  UserRecord,
} from "../src/domain/entities.js";
import { createRecordMeta } from "../src/domain/record-meta.js";
import type { AdminWorkspaceRepository } from "../src/repos/admin-workspace.js";

class InMemoryAdminRepo implements AdminWorkspaceRepository {
  public artists: ArtistRecord[] = [];
  public reports: ReportRecord[] = [];
  public users: UserRecord[] = [];
  public categories: CategoryRecord[] = [];
  public systemConfig: SystemConfigRecord | null = null;

  async listArtists(): Promise<ArtistRecord[]> {
    return this.artists;
  }

  async listAllArtists(): Promise<ArtistRecord[]> {
    return this.artists;
  }

  async getArtistById(artistId: string): Promise<ArtistRecord | null> {
    return this.artists.find((artist) => artist.id === artistId) || null;
  }

  async patchArtist(artist: ArtistRecord): Promise<void> {
    const index = this.artists.findIndex((item) => item.id === artist.id);
    if (index >= 0) {
      this.artists[index] = artist;
      return;
    }
    this.artists.unshift(artist);
  }

  async getServiceById(_serviceId: string): Promise<any> {
    return null;
  }

  async patchService(_service: any): Promise<void> {}

  async listReports(): Promise<ReportRecord[]> {
    return this.reports;
  }

  async getReportById(reportId: string): Promise<ReportRecord | null> {
    return this.reports.find((report) => report.id === reportId) || null;
  }

  async patchReport(report: ReportRecord): Promise<void> {
    this.reports = this.reports.map((item) => (item.id === report.id ? report : item));
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.users;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.id === userId) || null;
  }

  async patchUser(user: UserRecord): Promise<void> {
    const index = this.users.findIndex((item) => item.id === user.id);
    if (index >= 0) {
      this.users[index] = user;
    } else {
      this.users.push(user);
    }
  }

  async listCategories(): Promise<CategoryRecord[]> {
    return this.categories;
  }

  async getCategoryById(categoryId: string): Promise<CategoryRecord | null> {
    return this.categories.find((category) => category.id === categoryId) || null;
  }

  async patchCategory(category: CategoryRecord): Promise<void> {
    const index = this.categories.findIndex((item) => item.id === category.id);
    if (index >= 0) {
      this.categories[index] = category;
      return;
    }
    this.categories.unshift(category);
  }

  async getSystemConfig(): Promise<SystemConfigRecord | null> {
    return this.systemConfig;
  }

  async putSystemConfig(config: SystemConfigRecord): Promise<void> {
    this.systemConfig = config;
  }

  async patchSystemConfig(config: SystemConfigRecord): Promise<void> {
    this.systemConfig = config;
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

function baseRepo(): InMemoryAdminRepo {
  const repo = new InMemoryAdminRepo();

  repo.artists = [
    {
      ...createRecordMeta({ id: "a1", createdBy: "seed", now: nowIso(1) }),
      cognitoSub: "sub-artist-1",
      cognitoEmail: "artist1@example.com",
      name: "Artist One",
      handle: "artist-one",
      category: "Illustration",
      mediums: ["Digital"],
      location: "Sydney",
      verified: false,
      popularity: 10,
      rating: 4.5,
      reviewCount: 11,
      priceFrom: 300,
      availability: "open",
      bio: "bio",
      profileVisible: true,
      profileViews: 0,
      completedBookings: 0,
      acceptanceRate: 0,
      portfolio: [],
    },
    {
      ...createRecordMeta({ id: "a2", createdBy: "seed", now: nowIso(2) }),
      cognitoSub: "sub-artist-2",
      cognitoEmail: "artist2@example.com",
      name: "Artist Two",
      handle: "artist-two",
      category: "Painting",
      mediums: ["Oil"],
      location: "Melbourne",
      verified: true,
      popularity: 20,
      rating: 4.8,
      reviewCount: 20,
      priceFrom: 600,
      availability: "limited",
      bio: "bio",
      profileVisible: true,
      profileViews: 0,
      completedBookings: 0,
      acceptanceRate: 0,
      portfolio: [],
    },
  ];

  repo.reports = [
    {
      ...createRecordMeta({ id: "r1", createdBy: "seed", now: nowIso(3) }),
      type: "spam",
      status: "open",
      targetId: "a1",
      reportedById: "u1",
      note: "spam profile",
    },
    {
      ...createRecordMeta({ id: "r2", createdBy: "seed", now: nowIso(4) }),
      type: "abuse",
      status: "reviewing",
      targetId: "a2",
      reportedById: "u2",
      note: "abusive language",
    },
  ];

  repo.users = [
    {
      ...createRecordMeta({ id: "u1", createdBy: "seed", now: nowIso(1) }),
      cognitoSub: "sub-user-1",
      cognitoEmail: "user1@example.com",
      name: "User One",
      email: "user1@example.com",
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
    {
      ...createRecordMeta({ id: "u2", createdBy: "seed", now: nowIso(2) }),
      cognitoSub: "sub-user-2",
      cognitoEmail: "user2@example.com",
      name: "User Two",
      email: "user2@example.com",
      location: "Brisbane",
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
        completedAt: nowIso(2),
      },
      savedArtistIds: [],
      bookingHistoryIds: [],
      deleted: true,
    },
  ];

  repo.categories = [
    {
      ...createRecordMeta({ id: "c1", createdBy: "seed", now: nowIso(1) }),
      name: "Illustration",
      sortName: "illustration",
      active: true,
      activeStatus: "active",
    },
  ];

  repo.systemConfig = {
    ...createRecordMeta({ id: "system", createdBy: "seed", now: nowIso(1) }),
    maintenanceMode: false,
    errorLog: [
      {
        id: "e1",
        level: "error",
        message: "Sample error",
        createdAt: nowIso(5),
        resolved: false,
      },
      {
        id: "e2",
        level: "info",
        message: "Resolved event",
        createdAt: nowIso(4),
        resolved: true,
      },
    ],
  };

  return repo;
}

const adminClaims = {
  sub: "sub-admin-1",
  email: "admin@example.com",
  "cognito:username": "admin",
  "custom:roles": "admin",
};

const nonAdminClaims = {
  sub: "sub-user-1",
  email: "user1@example.com",
  "cognito:username": "user-one",
};

test("returns 401 when unauthenticated", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(makeEvent({ method: "GET", rawPath: "/v1/admin/system" }));
  assert.equal(response.statusCode, 401);
});

test("returns 403 when caller is not admin", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/admin/system",
      claims: nonAdminClaims,
    }),
  );

  assert.equal(response.statusCode, 403);
});

test("GET /v1/admin/artists/review returns moderation queue summary", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/admin/artists/review",
      claims: adminClaims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.summary.pending, 1);
  assert.equal(parsed.data.summary.verified, 1);
});

test("POST /v1/admin/artists/{id}/verify updates verified flag", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/admin/artists/a1/verify",
      pathParameters: { artistId: "a1" },
      claims: adminClaims,
      body: { note: "Looks good" },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.artist.verified, true);
  assert.equal(repo.artists[0].verified, true);
});

test("POST /v1/admin/artists/{id}/reject keeps artist unverified", async () => {
  const repo = baseRepo();
  repo.artists[1] = {
    ...repo.artists[1],
    verified: true,
  };

  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/admin/artists/a2/reject",
      pathParameters: { artistId: "a2" },
      claims: adminClaims,
      body: { note: "Need stronger portfolio evidence" },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.artist.verified, false);
});

test("GET /v1/admin/reports filters by status and type", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/admin/reports",
      claims: adminClaims,
      query: {
        status: "open",
        type: "spam",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.items.length, 1);
  assert.equal(parsed.data.items[0].id, "r1");
});

test("POST /v1/admin/reports/{id}/status updates report status and resolver", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/v1/admin/reports/r1/status",
      pathParameters: { reportId: "r1" },
      claims: adminClaims,
      body: {
        status: "resolved",
        note: "Reviewed and actioned",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.status, "resolved");
  assert.equal(parsed.data.resolvedById, "sub-admin-1");
});

test("GET /v1/admin/platform/users returns users and summary", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/admin/platform/users",
      claims: adminClaims,
      query: {
        limit: "1",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.items.length, 1);
  assert.equal(parsed.data.summary.total, 2);
});

test("PATCH /v1/admin/platform/categories/{id} updates category fields", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: "/v1/admin/platform/categories/c1",
      pathParameters: { categoryId: "c1" },
      claims: adminClaims,
      body: {
        name: "Character Illustration",
        active: false,
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.name, "Character Illustration");
  assert.equal(parsed.data.active, false);
  assert.equal(parsed.data.activeStatus, "inactive");
});

test("GET /v1/admin/system returns maintenance and metrics", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/admin/system",
      claims: adminClaims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.maintenanceMode, false);
  assert.equal(parsed.data.metrics.users, 2);
});

test("PATCH /v1/admin/system/maintenance persists maintenance mode", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "PATCH",
      rawPath: "/v1/admin/system/maintenance",
      claims: adminClaims,
      body: {
        maintenanceMode: true,
        note: "Deploying data fix",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.maintenanceMode, true);
  assert.equal(repo.systemConfig?.maintenanceMode, true);
});

test("GET /v1/admin/system/errors supports unresolved filter", async () => {
  const repo = baseRepo();
  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/admin/system/errors",
      claims: adminClaims,
      query: {
        includeResolved: "false",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.data.items.length, 1);
  assert.equal(parsed.data.items[0].id, "e1");
});

test("GET /v1/admin/system creates default config when missing", async () => {
  const repo = baseRepo();
  repo.systemConfig = null;

  const handler = createAdminApiHandler(repo);

  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/admin/system",
      claims: adminClaims,
    }),
  );

  assert.equal(response.statusCode, 200);
  const systemConfig = await repo.getSystemConfig();
  assert.ok(systemConfig);
  assert.equal(systemConfig.maintenanceMode, false);
});
