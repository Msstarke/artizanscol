import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { canTransitionBookingStatus, isBookingStatus } from "../domain/booking.js";
import { failure, success } from "../domain/api-response.js";
import type {
  ArtistRecord,
  BookingRecord,
  NotificationOwnerRole,
  NotificationRecord,
  UserRecord,
} from "../domain/entities.js";
import { ownerReadKey } from "../domain/index-keys.js";
import { createRecordMeta, touchRecordMeta } from "../domain/record-meta.js";
import { json } from "../lib/http.js";
import {
  requireAuthIdentity,
} from "../middleware/auth-context.js";
import { requireAnyRole } from "../middleware/authorization.js";
import {
  NoopRoleAssignmentsRepository,
  type RoleAssignmentsRepository,
} from "../repos/role-assignments.js";
import {
  NoopUserWorkspaceRepository,
  type UserWorkspaceRepository,
} from "../repos/user-workspace.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

function parseSavedArtistId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.artistId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/me\/saved-artists\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseBookingId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.bookingId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/bookings\/([^/?#]+)\/status$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function mapMe(user: UserRecord) {
  return {
    id: user.id,
    cognitoSub: user.cognitoSub,
    cognitoEmail: user.cognitoEmail,
    name: user.name,
    email: user.email,
    location: user.location,
    emailVerified: user.emailVerified,
    profileCompleted: user.profileCompleted,
    savedArtistsCount: user.savedArtistIds.length,
    bookingHistoryCount: user.bookingHistoryIds.length,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
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
    rating: artist.rating,
    reviewCount: artist.reviewCount,
    popularity: artist.popularity,
    priceFrom: artist.priceFrom,
    availability: artist.availability,
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

function mapNotification(notification: NotificationRecord) {
  return {
    id: notification.id,
    ownerId: notification.ownerId,
    ownerRole: notification.ownerRole,
    type: notification.type,
    title: notification.title,
    detail: notification.detail,
    read: notification.read,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
}

function normalizeName(value: unknown, field: string, max = 80): string {
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

function normalizeBudget(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RequestError(400, "INVALID_REQUEST", "budget must be a number greater than 0.");
  }
  return Math.round(numeric * 100) / 100;
}

function normalizeDeadline(value: unknown): string {
  const raw = String(value || "").trim();
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) {
    throw new RequestError(400, "INVALID_REQUEST", "deadline must be a valid ISO date.");
  }

  if (date.getTime() < Date.now()) {
    throw new RequestError(400, "INVALID_REQUEST", "deadline must be in the future.");
  }

  return date.toISOString();
}

async function emitNotification(
  repository: UserWorkspaceRepository,
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

  await repository.createNotification({
    ...meta,
    ownerId: args.ownerId,
    ownerRole: args.ownerRole,
    ownerReadKey: ownerReadKey(args.ownerId, false),
    type: args.type,
    title: args.title,
    detail: args.detail,
    read: false,
  });
}

async function handleGetMe(user: UserRecord): Promise<APIGatewayProxyStructuredResultV2> {
  return json(200, success(mapMe(user)));
}

async function handlePatchProfile(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{ name?: unknown; location?: unknown }>(event);

  const name = normalizeName(payload.name, "name", 80);
  const location = normalizeOptionalText(payload.location, "location", 80);

  const next = touchRecordMeta(
    {
      ...user,
      name,
      location,
      profileCompleted: true,
    },
    identitySub,
  );

  await repository.patchUser(next);
  return json(200, success(mapMe(next)));
}

async function handleGetSavedArtists(
  repository: UserWorkspaceRepository,
  user: UserRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const artists = await repository.listArtistsByIds(user.savedArtistIds);

  return json(
    200,
    success({
      items: artists.map(mapArtistCard),
      count: artists.length,
    }),
  );
}

async function handleSaveArtist(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const artistId = parseSavedArtistId(event);
  if (!artistId) {
    throw new RequestError(400, "INVALID_REQUEST", "artistId is required.");
  }

  const artist = await repository.getArtistById(artistId);
  if (!artist) {
    return json(404, failure("NOT_FOUND", "Artist not found."));
  }

  const updated = await repository.saveArtistForUser(user.id, artistId);
  return json(
    200,
    success({
      savedArtistsCount: updated.savedArtistIds.length,
      artist: mapArtistCard(artist),
    }),
  );
}

async function handleRemoveSavedArtist(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const artistId = parseSavedArtistId(event);
  if (!artistId) {
    throw new RequestError(400, "INVALID_REQUEST", "artistId is required.");
  }

  const updated = await repository.removeSavedArtistForUser(user.id, artistId);
  return json(200, success({ savedArtistsCount: updated.savedArtistIds.length }));
}

async function handleGetBookings(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const bookings = await repository.listBookingsByUserId(user.id);
  const sorted = [...bookings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items.map(mapBooking),
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handleCreateBooking(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    serviceId?: unknown;
    deadline?: unknown;
    budget?: unknown;
    message?: unknown;
  }>(event);

  const serviceId = normalizeName(payload.serviceId, "serviceId", 120);
  const deadline = normalizeDeadline(payload.deadline);
  const budget = normalizeBudget(payload.budget);
  const message = normalizeName(payload.message, "message", 3000);

  const service = await repository.getServiceById(serviceId);
  if (!service) {
    return json(404, failure("NOT_FOUND", "Service not found."));
  }

  const artist = await repository.getArtistById(service.artistId);
  if (!artist) {
    return json(404, failure("NOT_FOUND", "Artist not found."));
  }

  const meta = createRecordMeta({
    id: `b_${randomUUID()}`,
    createdBy: identitySub,
  });

  const booking: BookingRecord = {
    ...meta,
    userId: user.id,
    artistId: artist.id,
    serviceId,
    budget,
    deadline,
    message,
    status: "requested",
    threadId: `t_${user.id}_${artist.id}`,
    history: [],
  };

  await repository.createBooking(booking);

  const updatedUser = touchRecordMeta(
    {
      ...user,
      bookingHistoryIds: [booking.id, ...user.bookingHistoryIds],
    },
    identitySub,
  );
  await repository.patchUser(updatedUser);

  await emitNotification(repository, {
    ownerRole: "user",
    ownerId: user.id,
    type: "booking_created",
    title: "Booking request submitted",
    detail: `Your request to ${artist.name} is now pending review.`,
    createdBy: identitySub,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: artist.id,
    type: "booking_created",
    title: "New booking request",
    detail: `${user.name} sent a booking request for ${service.title}.`,
    createdBy: identitySub,
  });

  return json(201, success(mapBooking(booking)));
}

async function handleUpdateBookingStatus(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const bookingId = parseBookingId(event);
  if (!bookingId) {
    throw new RequestError(400, "INVALID_REQUEST", "bookingId is required.");
  }

  const payload = parseBody<{ status?: unknown; note?: unknown }>(event);
  const nextStatusRaw = normalizeName(payload.status, "status", 64);
  if (!isBookingStatus(nextStatusRaw)) {
    throw new RequestError(400, "INVALID_REQUEST", "status is invalid.");
  }

  const booking = await repository.getBookingById(bookingId);
  if (!booking) {
    return json(404, failure("NOT_FOUND", "Booking not found."));
  }

  if (booking.userId !== user.id) {
    return json(403, failure("FORBIDDEN", "You do not own this booking."));
  }

  if (!canTransitionBookingStatus(booking.status, nextStatusRaw)) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `Cannot transition booking from ${booking.status} to ${nextStatusRaw}.`,
    );
  }

  const note = normalizeOptionalText(payload.note, "note", 500);
  const updated = touchRecordMeta(
    {
      ...booking,
      status: nextStatusRaw,
      history: [
        ...booking.history,
        {
          at: new Date().toISOString(),
          by: identitySub,
          from: booking.status,
          to: nextStatusRaw,
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
    title: `Booking ${updated.id} updated`,
    detail: `Status changed to ${updated.status}.`,
    createdBy: identitySub,
  });

  await emitNotification(repository, {
    ownerRole: "artist",
    ownerId: updated.artistId,
    type: "booking_status",
    title: `Booking ${updated.id} updated`,
    detail: `Client updated status to ${updated.status}.`,
    createdBy: identitySub,
  });

  return json(200, success(mapBooking(updated)));
}

async function handleGetNotifications(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);

  const all = await repository.listNotificationsByOwner("user", user.id);
  const sorted = [...all].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items.map(mapNotification),
      unreadCount: all.filter((item) => !item.read).length,
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handleMarkNotificationsRead(
  repository: UserWorkspaceRepository,
  user: UserRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const updatedCount = await repository.markNotificationsRead("user", user.id);

  return json(
    200,
    success({
      updatedCount,
      ownerRole: "user",
      ownerId: user.id,
    }),
  );
}

export function createUserApiHandler(
  repository: UserWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository = new NoopRoleAssignmentsRepository(),
) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
      requireAnyRole(identity, ["user", "admin"]);

      const user = await repository.getUserByCognitoSub(identity.sub);
      if (!user) {
        return json(404, failure("NOT_FOUND", "User account not found."));
      }

      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      if (method === "GET" && path === "/v1/me") {
        return await handleGetMe(user);
      }

      if (method === "PATCH" && path === "/v1/me/profile") {
        return await handlePatchProfile(event, repository, user, identity.sub);
      }

      if (method === "GET" && path === "/v1/me/saved-artists") {
        return await handleGetSavedArtists(repository, user);
      }

      if (method === "POST" && path.startsWith("/v1/me/saved-artists/")) {
        return await handleSaveArtist(event, repository, user);
      }

      if (method === "DELETE" && path.startsWith("/v1/me/saved-artists/")) {
        return await handleRemoveSavedArtist(event, repository, user);
      }

      if (method === "GET" && path === "/v1/me/bookings") {
        return await handleGetBookings(event, repository, user);
      }

      if (method === "POST" && path === "/v1/bookings") {
        return await handleCreateBooking(event, repository, user, identity.sub);
      }

      if (method === "POST" && path.startsWith("/v1/bookings/") && path.endsWith("/status")) {
        return await handleUpdateBookingStatus(event, repository, user, identity.sub);
      }

      if (method === "GET" && path === "/v1/me/notifications") {
        return await handleGetNotifications(event, repository, user);
      }

      if (method === "POST" && path === "/v1/me/notifications/read-all") {
        return await handleMarkNotificationsRead(repository, user);
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

export const handler = createUserApiHandler(new NoopUserWorkspaceRepository());
