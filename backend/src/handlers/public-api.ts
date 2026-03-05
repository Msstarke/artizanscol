import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { failure, success } from "../domain/api-response.js";
import type { ArtistRecord, CategoryRecord, ServiceRecord } from "../domain/entities.js";
import { json } from "../lib/http.js";
import {
  NoopPublicDiscoveryRepository,
  type PublicDiscoveryRepository,
} from "../repos/public-discovery.js";

const PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=30";
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const ARTIST_SORTS = ["newest", "most_popular", "highest_rated"] as const;
const ARTIST_AVAILABILITY = ["open", "limited", "unavailable"] as const;

type ArtistSort = (typeof ARTIST_SORTS)[number];
type ArtistAvailability = (typeof ARTIST_AVAILABILITY)[number];

type PageRequest = {
  limit: number;
  offset: number;
  cursor: string | null;
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

function toLower(value: string): string {
  return String(value || "").toLowerCase();
}

function parseLimit(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_LIMIT;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new RequestError(400, "INVALID_REQUEST", `limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  return value;
}

function encodeCursor(offset: number): string | null {
  if (offset <= 0) {
    return null;
  }
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function decodeCursor(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const value = Number(decoded);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("invalid");
    }
    return value;
  } catch (_) {
    throw new RequestError(400, "INVALID_REQUEST", "cursor is invalid.");
  }
}

function parseOptionalNumber(name: string, raw: string | undefined): number | null {
  if (!raw || !raw.trim()) {
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new RequestError(400, "INVALID_REQUEST", `${name} must be a number greater than or equal to 0.`);
  }
  return value;
}

function parseSort(raw: string | undefined): ArtistSort {
  if (!raw) {
    return "newest";
  }

  if (!ARTIST_SORTS.includes(raw as ArtistSort)) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `sort must be one of: ${ARTIST_SORTS.join(", ")}.`,
    );
  }

  return raw as ArtistSort;
}

function parseAvailability(raw: string | undefined): ArtistAvailability | null {
  if (!raw) {
    return null;
  }

  if (!ARTIST_AVAILABILITY.includes(raw as ArtistAvailability)) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `availability must be one of: ${ARTIST_AVAILABILITY.join(", ")}.`,
    );
  }

  return raw as ArtistAvailability;
}

function parseActive(raw: string | undefined): boolean | null {
  if (!raw) {
    return true;
  }

  const normalized = toLower(raw).trim();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  if (normalized === "all") {
    return null;
  }

  throw new RequestError(400, "INVALID_REQUEST", "active must be true, false, or all.");
}

function parsePage(query: Record<string, string | undefined>): PageRequest {
  return {
    limit: parseLimit(query.limit),
    offset: decodeCursor(query.cursor),
    cursor: query.cursor || null,
  };
}

function pageItems<T>(items: T[], page: PageRequest): { items: T[]; nextCursor: string | null } {
  const slice = items.slice(page.offset, page.offset + page.limit);
  const nextOffset = page.offset + slice.length;
  const hasMore = nextOffset < items.length;

  return {
    items: slice,
    nextCursor: hasMore ? encodeCursor(nextOffset) : null,
  };
}

function mapArtistCard(artist: ArtistRecord) {
  return {
    id: artist.id,
    name: artist.name,
    handle: artist.handle,
    category: artist.category,
    mediums: artist.mediums,
    location: artist.location,
    verified: artist.verified,
    popularity: artist.popularity,
    rating: artist.rating,
    reviewCount: artist.reviewCount,
    priceFrom: artist.priceFrom,
    availability: artist.availability,
    bio: artist.bio,
    profileViews: artist.profileViews,
    completedBookings: artist.completedBookings,
    acceptanceRate: artist.acceptanceRate,
    createdAt: artist.createdAt,
    updatedAt: artist.updatedAt,
  };
}

function sortArtists(artists: ArtistRecord[], sort: ArtistSort): ArtistRecord[] {
  const clone = [...artists];

  if (sort === "newest") {
    return clone.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  if (sort === "most_popular") {
    return clone.sort((a, b) => b.popularity - a.popularity || b.rating - a.rating);
  }

  return clone.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
}

function matchSearch(artist: ArtistRecord, search: string): boolean {
  if (!search) {
    return true;
  }

  const haystack = [
    artist.name,
    artist.handle,
    artist.category,
    artist.location,
    artist.bio,
    ...artist.mediums,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

function toQueryMap(
  query: APIGatewayProxyEventV2["queryStringParameters"],
): Record<string, string | undefined> {
  return {
    q: query?.q,
    category: query?.category,
    location: query?.location,
    medium: query?.medium,
    availability: query?.availability,
    minPrice: query?.minPrice,
    maxPrice: query?.maxPrice,
    sort: query?.sort,
    active: query?.active,
    limit: query?.limit,
    cursor: query?.cursor,
  };
}

async function handleListCategories(
  event: APIGatewayProxyEventV2,
  repository: PublicDiscoveryRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const query = toQueryMap(event.queryStringParameters);
  const page = parsePage(query);
  const active = parseActive(query.active);

  const all = await repository.listCategories();
  const filtered = active == null ? all : all.filter((category) => category.active === active);
  const sorted = [...filtered].sort((a, b) => a.sortName.localeCompare(b.sortName));
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items.map((item: CategoryRecord) => ({
        id: item.id,
        name: item.name,
        active: item.active,
        sortName: item.sortName,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
    {
      cacheControl: PUBLIC_CACHE_CONTROL,
    },
  );
}

async function handleListArtists(
  event: APIGatewayProxyEventV2,
  repository: PublicDiscoveryRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const query = toQueryMap(event.queryStringParameters);
  const page = parsePage(query);

  const search = toLower(query.q || "").trim();
  const category = toLower(query.category || "").trim();
  const location = toLower(query.location || "").trim();
  const medium = toLower(query.medium || "").trim();
  const availability = parseAvailability(query.availability);
  const minPrice = parseOptionalNumber("minPrice", query.minPrice);
  const maxPrice = parseOptionalNumber("maxPrice", query.maxPrice);
  const sort = parseSort(query.sort);

  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    throw new RequestError(400, "INVALID_REQUEST", "minPrice cannot be greater than maxPrice.");
  }

  const all = await repository.listArtists();

  const filtered = all.filter((artist) => {
    if (category && toLower(artist.category) !== category) {
      return false;
    }

    if (location && !toLower(artist.location).includes(location)) {
      return false;
    }

    if (medium && !artist.mediums.some((item) => toLower(item) === medium)) {
      return false;
    }

    if (availability && artist.availability !== availability) {
      return false;
    }

    if (minPrice != null && Number(artist.priceFrom || 0) < minPrice) {
      return false;
    }

    if (maxPrice != null && Number(artist.priceFrom || 0) > maxPrice) {
      return false;
    }

    if (!matchSearch(artist, search)) {
      return false;
    }

    return true;
  });

  const sorted = sortArtists(filtered, sort);
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items.map(mapArtistCard),
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
      query: {
        q: search || null,
        category: category || null,
        location: location || null,
        medium: medium || null,
        availability,
        minPrice,
        maxPrice,
        sort,
      },
    }),
    {
      cacheControl: PUBLIC_CACHE_CONTROL,
    },
  );
}

function extractArtistId(event: APIGatewayProxyEventV2): string | null {
  const fromParam = String(event.pathParameters?.artistId || "").trim();
  if (fromParam) {
    return fromParam;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/artists\/([^/?#]+)$/);
  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

async function handleGetArtistById(
  event: APIGatewayProxyEventV2,
  repository: PublicDiscoveryRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const artistId = extractArtistId(event);

  if (!artistId) {
    throw new RequestError(400, "INVALID_REQUEST", "artistId is required.");
  }

  const artists = await repository.listArtists();
  const artist = artists.find((item) => item.id === artistId);

  if (!artist) {
    return json(404, failure("NOT_FOUND", "Artist not found."));
  }

  const services = await repository.listServicesByArtistId(artistId);

  return json(
    200,
    success({
      profile: {
        ...mapArtistCard(artist),
        portfolio: artist.portfolio,
      },
      services: services.map((service: ServiceRecord) => ({
        id: service.id,
        title: service.title,
        description: service.description,
        price: service.price,
        deliveryDays: service.deliveryDays,
      })),
      reviewsSummary: {
        rating: artist.rating,
        reviewCount: artist.reviewCount,
        note: artist.reviewCount ? "Based on completed customer reviews." : "No reviews yet.",
      },
      availability: {
        status: artist.availability,
        canBook: artist.availability !== "unavailable",
      },
    }),
    {
      cacheControl: PUBLIC_CACHE_CONTROL,
    },
  );
}

export function createPublicApiHandler(repository: PublicDiscoveryRepository) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      if (method === "GET" && path === "/v1/categories") {
        return await handleListCategories(event, repository);
      }

      if (method === "GET" && path === "/v1/artists") {
        return await handleListArtists(event, repository);
      }

      if (method === "GET" && path.startsWith("/v1/artists/")) {
        return await handleGetArtistById(event, repository);
      }

      return json(404, failure("NOT_FOUND", "Route not found."));
    } catch (error) {
      if (error instanceof RequestError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      return json(500, failure("INTERNAL_ERROR", "Unexpected server error."));
    }
  };
}

export const handler = createPublicApiHandler(new NoopPublicDiscoveryRepository());
