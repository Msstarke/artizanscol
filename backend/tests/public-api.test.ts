import test from "node:test";
import assert from "node:assert/strict";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { ArtistRecord, CategoryRecord, ServiceRecord } from "../src/domain/entities.js";
import { createPublicApiHandler } from "../src/handlers/public-api.js";
import {
  type PublicDiscoveryRepository,
} from "../src/repos/public-discovery.js";

class InMemoryPublicDiscoveryRepo implements PublicDiscoveryRepository {
  constructor(
    private readonly categories: CategoryRecord[],
    private readonly artists: ArtistRecord[],
    private readonly services: ServiceRecord[],
  ) {}

  async listCategories(): Promise<CategoryRecord[]> {
    return this.categories;
  }

  async listArtists(): Promise<ArtistRecord[]> {
    return this.artists;
  }

  async listServicesByArtistId(artistId: string): Promise<ServiceRecord[]> {
    return this.services.filter((service) => service.artistId === artistId);
  }
}

function nowIso(day: number): string {
  return `2026-03-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

function makeCategory(id: string, name: string, active: boolean): CategoryRecord {
  return {
    id,
    createdBy: "seed",
    createdAt: nowIso(1),
    updatedAt: nowIso(1),
    version: 1,
    name,
    sortName: name.toLowerCase(),
    active,
    activeStatus: active ? "active" : "inactive",
  };
}

function makeArtist(args: {
  id: string;
  name: string;
  category: string;
  location: string;
  mediums: string[];
  availability: "open" | "limited" | "unavailable";
  popularity: number;
  rating: number;
  reviewCount: number;
  priceFrom: number;
  createdDay: number;
}): ArtistRecord {
  return {
    id: args.id,
    createdBy: "seed",
    createdAt: nowIso(args.createdDay),
    updatedAt: nowIso(args.createdDay),
    version: 1,
    cognitoSub: `sub-${args.id}`,
    cognitoEmail: `${args.id}@example.com`,
    name: args.name,
    handle: args.name.toLowerCase().replace(/\s+/g, "-"),
    category: args.category,
    mediums: args.mediums,
    location: args.location,
    verified: true,
    popularity: args.popularity,
    rating: args.rating,
    reviewCount: args.reviewCount,
    priceFrom: args.priceFrom,
    availability: args.availability,
    bio: `${args.name} bio`,
    profileVisible: true,
    profileViews: 0,
    completedBookings: 0,
    acceptanceRate: 0,
    portfolio: [],
  };
}

function makeService(id: string, artistId: string, title: string): ServiceRecord {
  return {
    id,
    createdBy: "seed",
    createdAt: nowIso(2),
    updatedAt: nowIso(2),
    version: 1,
    artistId,
    title,
    description: `${title} description`,
    price: 200,
    deliveryDays: 7,
  };
}

function makeEvent(args: {
  method: string;
  rawPath: string;
  query?: Record<string, string>;
  pathParameters?: Record<string, string>;
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
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "",
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
    queryStringParameters: args.query,
    pathParameters: args.pathParameters,
  } as APIGatewayProxyEventV2;
}

const repo = new InMemoryPublicDiscoveryRepo(
  [
    makeCategory("c1", "Illustration", true),
    makeCategory("c2", "Branding", true),
    makeCategory("c3", "Editorial", false),
  ],
  [
    makeArtist({
      id: "a1",
      name: "Alpha Artist",
      category: "Illustration",
      location: "Sydney",
      mediums: ["Digital"],
      availability: "open",
      popularity: 200,
      rating: 4.9,
      reviewCount: 15,
      priceFrom: 300,
      createdDay: 3,
    }),
    makeArtist({
      id: "a2",
      name: "Beta Brush",
      category: "Branding",
      location: "Melbourne",
      mediums: ["Traditional", "Digital"],
      availability: "limited",
      popularity: 120,
      rating: 4.5,
      reviewCount: 8,
      priceFrom: 220,
      createdDay: 2,
    }),
    {
      ...makeArtist({
        id: "a3",
        name: "Draft Designer",
        category: "Branding",
        location: "Brisbane",
        mediums: ["Digital"],
        availability: "open",
        popularity: 10,
        rating: 4.1,
        reviewCount: 2,
        priceFrom: 180,
        createdDay: 1,
      }),
      priceFrom: 0,
      profileVisible: true,
    },
  ],
  [
    makeService("s1", "a1", "Logo Pack"),
    makeService("s2", "a1", "Poster Series"),
    makeService("s3", "a2", "Brand Starter"),
  ],
);

const handler = createPublicApiHandler(repo);

test("GET /v1/categories returns active categories with cache headers", async () => {
  const response = await handler(makeEvent({ method: "GET", rawPath: "/v1/categories" }));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.["cache-control"], "public, max-age=60, s-maxage=300, stale-while-revalidate=30");

  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.items.length, 2);
  assert.equal(parsed.data.items[0].name, "Branding");
});

test("GET /v1/artists validates sort query", async () => {
  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artists",
      query: { sort: "invalid_sort" },
    }),
  );

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "INVALID_REQUEST");
});

test("GET /v1/artists applies filters and pagination", async () => {
  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artists",
      query: {
        category: "illustration",
        limit: "1",
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.items.length, 1);
  assert.equal(parsed.data.items[0].id, "a1");
  assert.equal(parsed.data.items[0].profileVisible, true);
  assert.equal(parsed.data.items[0].publishState, "live");
  assert.equal(parsed.data.pagination.nextCursor, null);
});

test("GET /v1/artists filters out incomplete drafts even if profileVisible is true", async () => {
  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artists",
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.data.items.map((item: { id: string }) => item.id).sort(),
    ["a1", "a2"],
  );
});

test("GET /v1/artists/{artistId} returns profile and services", async () => {
  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artists/a1",
      pathParameters: { artistId: "a1" },
    }),
  );

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.profile.id, "a1");
  assert.equal(parsed.data.services.length, 2);
  assert.equal(parsed.data.availability.status, "open");
});

test("GET /v1/artists/{artistId} returns 404 when artist is missing", async () => {
  const response = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/v1/artists/a999",
      pathParameters: { artistId: "a999" },
    }),
  );

  assert.equal(response.statusCode, 404);
  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "NOT_FOUND");
});
