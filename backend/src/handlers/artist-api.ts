import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { canTransitionBookingStatus } from "../domain/booking.js";
import { failure, success } from "../domain/api-response.js";
import type {
  ArtistRecord,
  BookingRecord,
  MessageRecord,
  NotificationOwnerRole,
  NotificationRecord,
  PortfolioItem,
  ServiceRecord,
} from "../domain/entities.js";
import { ownerReadKey } from "../domain/index-keys.js";
import { createRecordMeta, touchRecordMeta } from "../domain/record-meta.js";
import { json } from "../lib/http.js";
import { requireAuthIdentity } from "../middleware/auth-context.js";
import { requireAnyRole } from "../middleware/authorization.js";
import {
  NoopRoleAssignmentsRepository,
  type RoleAssignmentsRepository,
} from "../repos/role-assignments.js";
import {
  NoopArtistWorkspaceRepository,
  type ArtistWorkspaceRepository,
} from "../repos/artist-workspace.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const AVAILABILITY_VALUES = ["open", "limited", "unavailable"] as const;

type AvailabilityValue = (typeof AVAILABILITY_VALUES)[number];

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

function encodeCursor(offset: number): string | null {
  if (offset <= 0) {
    return null;
  }

  return Buffer.from(String(offset), "utf8").toString("base64");
}

function parsePage(query: APIGatewayProxyEventV2["queryStringParameters"]): PageRequest {
  return {
    limit: parseLimit(query?.limit),
    offset: decodeCursor(query?.cursor),
    cursor: query?.cursor || null,
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

function parseBody<T>(event: APIGatewayProxyEventV2): T {
  if (!event.body) {
    throw new RequestError(400, "INVALID_REQUEST", "Request body is required.");
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    return JSON.parse(raw) as T;
  } catch (_) {
    throw new RequestError(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  }
}

function parseServiceId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.serviceId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/artist\/me\/services\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseArtistBookingPath(event: APIGatewayProxyEventV2): {
  bookingId: string;
  action: "accept" | "decline";
} | null {
  const bookingId = String(event.pathParameters?.bookingId || "").trim();
  const action = String(event.pathParameters?.action || "").trim().toLowerCase();

  if (bookingId && (action === "accept" || action === "decline")) {
    return {
      bookingId,
      action,
    };
  }

  const match = String(event.rawPath || "").match(
    /^\/v1\/artist\/me\/bookings\/([^/?#]+)\/(accept|decline)$/,
  );

  if (!match) {
    return null;
  }

  return {
    bookingId: decodeURIComponent(match[1]),
    action: match[2] as "accept" | "decline",
  };
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

function normalizeOptionalText(value: unknown, field: string, max: number): string {
  const trimmed = String(value || "").trim();
  if (trimmed.length > max) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be ${max} characters or less.`);
  }
  return trimmed;
}

function normalizeMoney(value: unknown, field: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be a number greater than 0.`);
  }

  return Math.round(numeric * 100) / 100;
}

function normalizeInteger(value: unknown, field: string, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `${field} must be an integer between ${min} and ${max}.`,
    );
  }
  return numeric;
}

function normalizeAvailability(value: unknown): AvailabilityValue {
  const normalized = String(value || "").trim().toLowerCase();
  if (!AVAILABILITY_VALUES.includes(normalized as AvailabilityValue)) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `availability must be one of: ${AVAILABILITY_VALUES.join(", ")}.`,
    );
  }

  return normalized as AvailabilityValue;
}

function normalizeStringArray(value: unknown, field: string, maxItems = 12, maxLength = 60): string[] {
  if (!Array.isArray(value)) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be an array.`);
  }

  const items = value
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (!items.length) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must include at least one value.`);
  }

  if (items.length > maxItems) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} cannot include more than ${maxItems} items.`);
  }

  items.forEach((item) => {
    if (item.length > maxLength) {
      throw new RequestError(400, "INVALID_REQUEST", `${field} items must be ${maxLength} characters or less.`);
    }
  });

  return Array.from(new Set(items));
}

function normalizePortfolio(value: unknown): PortfolioItem[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RequestError(400, "INVALID_REQUEST", "portfolio must be an array.");
  }

  if (value.length > 40) {
    throw new RequestError(400, "INVALID_REQUEST", "portfolio cannot include more than 40 items.");
  }

  return value.map((item, index) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const title = normalizeRequiredText(record.title, `portfolio[${index}].title`, 120);
    const medium = normalizeRequiredText(record.medium, `portfolio[${index}].medium`, 60);
    const imageUrl = normalizeOptionalText(record.imageUrl, `portfolio[${index}].imageUrl`, 500);

    return {
      id: normalizeOptionalText(record.id, `portfolio[${index}].id`, 80) || `p_${randomUUID()}`,
      title,
      medium,
      imageUrl: imageUrl || undefined,
      createdAt: new Date().toISOString(),
    };
  });
}

async function emitNotification(
  repository: ArtistWorkspaceRepository,
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

function mapArtist(artist: ArtistRecord) {
  return {
    id: artist.id,
    cognitoSub: artist.cognitoSub,
    cognitoEmail: artist.cognitoEmail,
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
    portfolio: artist.portfolio,
    createdAt: artist.createdAt,
    updatedAt: artist.updatedAt,
  };
}

function mapService(service: ServiceRecord) {
  return {
    id: service.id,
    artistId: service.artistId,
    title: service.title,
    description: service.description,
    price: service.price,
    deliveryDays: service.deliveryDays,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

function mapBooking(booking: BookingRecord) {
  return {
    id: booking.id,
    userId: booking.userId,
    artistId: booking.artistId,
    serviceId: booking.serviceId,
    budget: booking.budget,
    deadline: booking.deadline,
    message: booking.message,
    status: booking.status,
    threadId: booking.threadId,
    history: booking.history,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

async function handleGetArtistMe(
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const services = await repository.listServicesByArtistId(artist.id);

  return json(
    200,
    success({
      ...mapArtist(artist),
      serviceCount: services.length,
    }),
  );
}

async function handlePatchArtistProfile(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    name?: unknown;
    handle?: unknown;
    location?: unknown;
    bio?: unknown;
    availability?: unknown;
  }>(event);

  const next = touchRecordMeta(
    {
      ...artist,
      name: normalizeRequiredText(payload.name ?? artist.name, "name", 80),
      handle: normalizeRequiredText(payload.handle ?? artist.handle, "handle", 60),
      location: normalizeRequiredText(payload.location ?? artist.location, "location", 80),
      bio: normalizeOptionalText(payload.bio ?? artist.bio, "bio", 1200),
      availability: payload.availability
        ? normalizeAvailability(payload.availability)
        : artist.availability,
    },
    identitySub,
  );

  await repository.patchArtist(next);
  return json(200, success(mapArtist(next)));
}

async function handlePutOnboarding(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    category?: unknown;
    mediums?: unknown;
    priceFrom?: unknown;
    availability?: unknown;
    portfolio?: unknown;
  }>(event);

  const next = touchRecordMeta(
    {
      ...artist,
      category: normalizeRequiredText(payload.category, "category", 80),
      mediums: normalizeStringArray(payload.mediums, "mediums", 16, 60),
      priceFrom: normalizeMoney(payload.priceFrom, "priceFrom"),
      availability: normalizeAvailability(payload.availability),
      portfolio: normalizePortfolio(payload.portfolio),
    },
    identitySub,
  );

  await repository.patchArtist(next);
  return json(200, success(mapArtist(next)));
}

async function handleCreateService(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    title?: unknown;
    description?: unknown;
    price?: unknown;
    deliveryDays?: unknown;
  }>(event);

  const meta = createRecordMeta({
    id: `s_${randomUUID()}`,
    createdBy: identitySub,
  });

  const service: ServiceRecord = {
    ...meta,
    artistId: artist.id,
    title: normalizeRequiredText(payload.title, "title", 120),
    description: normalizeRequiredText(payload.description, "description", 2000),
    price: normalizeMoney(payload.price, "price"),
    deliveryDays: normalizeInteger(payload.deliveryDays, "deliveryDays", 1, 365),
  };

  await repository.createService(service);
  return json(201, success(mapService(service)));
}

async function handleUpdateService(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const serviceId = parseServiceId(event);
  if (!serviceId) {
    throw new RequestError(400, "INVALID_REQUEST", "serviceId is required.");
  }

  const existing = await repository.getServiceById(serviceId);
  if (!existing || existing.artistId !== artist.id) {
    return json(404, failure("NOT_FOUND", "Service not found."));
  }

  const payload = parseBody<{
    title?: unknown;
    description?: unknown;
    price?: unknown;
    deliveryDays?: unknown;
  }>(event);

  const next = touchRecordMeta(
    {
      ...existing,
      title: payload.title == null
        ? existing.title
        : normalizeRequiredText(payload.title, "title", 120),
      description: payload.description == null
        ? existing.description
        : normalizeRequiredText(payload.description, "description", 2000),
      price: payload.price == null ? existing.price : normalizeMoney(payload.price, "price"),
      deliveryDays: payload.deliveryDays == null
        ? existing.deliveryDays
        : normalizeInteger(payload.deliveryDays, "deliveryDays", 1, 365),
    },
    identitySub,
  );

  await repository.updateService(next);
  return json(200, success(mapService(next)));
}

async function handleDeleteService(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const serviceId = parseServiceId(event);
  if (!serviceId) {
    throw new RequestError(400, "INVALID_REQUEST", "serviceId is required.");
  }

  const existing = await repository.getServiceById(serviceId);
  if (!existing || existing.artistId !== artist.id) {
    return json(404, failure("NOT_FOUND", "Service not found."));
  }

  await repository.deleteService(serviceId);
  return json(200, success({ deleted: true, id: serviceId }));
}

async function handleListArtistBookings(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const all = await repository.listBookingsByArtistId(artist.id);

  const sorted = [...all].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  const grouped = {
    incoming: all.filter((item) => item.status === "requested").length,
    confirmed: all.filter((item) => item.status === "confirmed").length,
    cancellations: all.filter((item) => item.status === "cancelled").length,
  };

  return json(
    200,
    success({
      items: paged.items.map(mapBooking),
      grouped,
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handleBookingDecision(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const bookingAction = parseArtistBookingPath(event);
  if (!bookingAction) {
    throw new RequestError(400, "INVALID_REQUEST", "bookingId and action are required.");
  }

  const booking = await repository.getBookingById(bookingAction.bookingId);
  if (!booking || booking.artistId !== artist.id) {
    return json(404, failure("NOT_FOUND", "Booking not found."));
  }

  const nextStatus: BookingRecord["status"] = bookingAction.action === "accept"
    ? "accepted"
    : "declined";
  if (!canTransitionBookingStatus(booking.status, nextStatus)) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `Cannot transition booking from ${booking.status} to ${nextStatus}.`,
    );
  }

  const payload = parseBody<{ note?: unknown }>(event);
  const note = normalizeOptionalText(payload.note, "note", 500);

  const updated = touchRecordMeta(
    {
      ...booking,
      status: nextStatus,
      history: [
        ...booking.history,
        {
          at: new Date().toISOString(),
          by: identitySub,
          from: booking.status,
          to: nextStatus,
          note: note || undefined,
        },
      ],
    },
    identitySub,
  );

  await repository.updateBooking(updated);

  await emitNotification(repository, {
    ownerRole: "user",
    ownerId: updated.userId,
    type: "booking_status",
    title: `Booking ${updated.id} ${nextStatus}`,
    detail: `${artist.name} ${nextStatus} your booking request.`,
    createdBy: identitySub,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: updated.artistId,
    type: "booking_status",
    title: `You ${nextStatus} booking ${updated.id}`,
    detail: `Status updated to ${nextStatus}.`,
    createdBy: identitySub,
  });

  return json(200, success(mapBooking(updated)));
}

async function handleGetArtistEarnings(
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const bookings = await repository.listBookingsByArtistId(artist.id);

  const paidCompleted = bookings.filter(
    (item) => item.status === "paid" || item.status === "completed",
  );
  const gross = paidCompleted.reduce((sum, item) => sum + item.budget, 0);

  const snapshot = {
    grossRevenue: Math.round(gross * 100) / 100,
    paidOrCompletedCount: paidCompleted.length,
    completedCount: bookings.filter((item) => item.status === "completed").length,
    paymentPendingCount: bookings.filter((item) => item.status === "payment_pending").length,
    cancelledCount: bookings.filter((item) => item.status === "cancelled").length,
    currency: "AUD",
  };

  return json(200, success(snapshot));
}

function countStatuses(bookings: BookingRecord[]) {
  return bookings.reduce<Record<BookingRecord["status"], number>>(
    (counts, booking) => {
      counts[booking.status] += 1;
      return counts;
    },
    {
      requested: 0,
      accepted: 0,
      declined: 0,
      confirmed: 0,
      payment_pending: 0,
      paid: 0,
      completed: 0,
      cancelled: 0,
    },
  );
}

function mapMessageThreads(messages: MessageRecord[]): { messageCount: number; threadCount: number } {
  const threadIds = new Set(messages.map((item) => item.threadId));
  return {
    messageCount: messages.length,
    threadCount: threadIds.size,
  };
}

async function handleGetArtistAnalytics(
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const bookings = await repository.listBookingsByArtistId(artist.id);
  const messages = await repository.listMessagesByParticipantId(artist.id);

  const status = countStatuses(bookings);

  const acceptedPipeline =
    status.accepted + status.confirmed + status.payment_pending + status.paid + status.completed;
  const decidedCount = acceptedPipeline + status.declined;

  const acceptanceRate = decidedCount > 0
    ? Math.round((acceptedPipeline / decidedCount) * 1000) / 10
    : artist.acceptanceRate;
  const completionRate = bookings.length
    ? Math.round((status.completed / bookings.length) * 1000) / 10
    : 0;

  const messaging = mapMessageThreads(messages);

  return json(
    200,
    success({
      profileViews: artist.profileViews,
      bookingPerformance: {
        total: bookings.length,
        byStatus: status,
        acceptanceRate,
        completionRate,
      },
      messaging,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function createArtistApiHandler(
  repository: ArtistWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository = new NoopRoleAssignmentsRepository(),
) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
      requireAnyRole(identity, ["artist", "admin"]);

      const artist = await repository.getArtistByCognitoSub(identity.sub);
      if (!artist) {
        return json(404, failure("NOT_FOUND", "Artist account not found."));
      }

      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      if (method === "GET" && path === "/v1/artist/me") {
        return await handleGetArtistMe(repository, artist);
      }

      if (method === "PATCH" && path === "/v1/artist/me/profile") {
        return await handlePatchArtistProfile(event, repository, artist, identity.sub);
      }

      if (method === "PUT" && path === "/v1/artist/me/onboarding") {
        return await handlePutOnboarding(event, repository, artist, identity.sub);
      }

      if (method === "POST" && path === "/v1/artist/me/services") {
        return await handleCreateService(event, repository, artist, identity.sub);
      }

      if (method === "PATCH" && path.startsWith("/v1/artist/me/services/")) {
        return await handleUpdateService(event, repository, artist, identity.sub);
      }

      if (method === "DELETE" && path.startsWith("/v1/artist/me/services/")) {
        return await handleDeleteService(event, repository, artist);
      }

      if (method === "GET" && path === "/v1/artist/me/bookings") {
        return await handleListArtistBookings(event, repository, artist);
      }

      if (method === "POST" && /^\/v1\/artist\/me\/bookings\/[^/]+\/(accept|decline)$/.test(path)) {
        return await handleBookingDecision(event, repository, artist, identity.sub);
      }

      if (method === "GET" && path === "/v1/artist/me/earnings") {
        return await handleGetArtistEarnings(repository, artist);
      }

      if (method === "GET" && path === "/v1/artist/me/analytics") {
        return await handleGetArtistAnalytics(repository, artist);
      }

      return json(404, failure("NOT_FOUND", "Route not found."));
    } catch (error) {
      if (error instanceof RequestError) {
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

export const handler = createArtistApiHandler(new NoopArtistWorkspaceRepository());
