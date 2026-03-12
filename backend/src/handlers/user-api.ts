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
import { auditLog } from "../lib/audit.js";
import { json } from "../lib/http.js";
import { type JsonSchema, parseJsonRequestBody, validateSchema } from "../lib/schema.js";
import {
  requireAuthIdentity,
} from "../middleware/auth-context.js";
import { requireAnyRole } from "../middleware/authorization.js";
import { SecurityPolicyError, enforceRequestSecurity } from "../middleware/request-security.js";
import {
  NoopRoleAssignmentsRepository,
  type RoleAssignmentsRepository,
} from "../repos/role-assignments.js";
import {
  NoopArtistWorkspaceRepository,
  type ArtistWorkspaceRepository,
} from "../repos/artist-workspace.js";
import {
  NoopUserWorkspaceRepository,
  type UserWorkspaceRepository,
} from "../repos/user-workspace.js";
import {
  getArtistWorkspaceRepository,
  getRoleAssignmentsRepository,
  getUserWorkspaceRepository,
} from "../repos/runtime.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const USER_PROFILE_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: true,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    location: { type: "string", maxLength: 80, nullable: true },
    bio: { type: "string", maxLength: 280, nullable: true },
  },
};
const USER_PREFERENCES_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["bookingUpdates", "messageAlerts", "marketingEmails", "browserNotifications"],
  additionalProperties: true,
  properties: {
    bookingUpdates: { type: "boolean" },
    messageAlerts: { type: "boolean" },
    marketingEmails: { type: "boolean" },
    browserNotifications: { type: "boolean" },
  },
};
const USER_SETUP_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    status: { type: "string", enum: ["not_started", "in_progress", "completed"], nullable: true },
    currentStep: {
      type: "string",
      enum: ["welcome", "profile", "preferences", "artist_prompt", "artist_profile", "review", "done"],
      nullable: true,
    },
    artistOptIn: { type: "boolean", nullable: true },
  },
};
const USER_BOOKING_CREATE_SCHEMA: JsonSchema = {
  type: "object",
  required: ["deadline", "budget", "message"],
  additionalProperties: true,
  properties: {
    serviceId: { type: "string", minLength: 1, maxLength: 120, nullable: true },
    artistId: { type: "string", minLength: 1, maxLength: 120, nullable: true },
    serviceLabel: { type: "string", minLength: 1, maxLength: 160, nullable: true },
    deadline: { type: "string", minLength: 1, maxLength: 64 },
    budget: { type: "number", minimum: 0.01 },
    message: { type: "string", minLength: 1, maxLength: 3000 },
  },
};
const USER_BOOKING_STATUS_SCHEMA: JsonSchema = {
  type: "object",
  required: ["status"],
  additionalProperties: true,
  properties: {
    status: { type: "string", minLength: 1, maxLength: 64 },
    note: { type: "string", maxLength: 500, nullable: true },
  },
};

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

const DEFAULT_USER_PREFERENCES = {
  bookingUpdates: true,
  messageAlerts: true,
  marketingEmails: false,
  browserNotifications: false,
} as const;

const DEFAULT_USER_SETUP = {
  status: "not_started",
  currentStep: "welcome",
  artistOptIn: false,
  completedAt: null,
} as const;

type ArtistNameSyncRepository = Pick<ArtistWorkspaceRepository, "getArtistByCognitoSub" | "patchArtist">;

function normalizeDisplayName(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isOpaqueIdentityName(value: string | null | undefined): boolean {
  const trimmed = normalizeDisplayName(value);
  if (!trimmed) {
    return false;
  }

  const compact = trimmed.replace(/[\s-]+/g, "");
  if (compact.length === 32 && /^[a-f0-9]{32}$/i.test(compact)) {
    return true;
  }

  return /^[a-f0-9]{8}(?:[\s-]?[a-f0-9]{4}){3}[\s-]?[a-f0-9]{12}$/i.test(trimmed);
}

function emailPrefixDisplayName(email: string | null | undefined): string {
  const emailPrefix = String(email || "").trim().split("@")[0] || "";
  if (!emailPrefix) {
    return "";
  }

  return emailPrefix
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayNameFromIdentity(identity: { email: string | null; username: string | null }): string {
  const fromUsername = normalizeDisplayName(identity.username);
  if (fromUsername && !isOpaqueIdentityName(fromUsername)) {
    return fromUsername;
  }

  const fromEmail = emailPrefixDisplayName(identity.email);
  if (!fromEmail) {
    return "Member";
  }

  return fromEmail;
}

async function syncArtistProfileFromUser(
  artistRepository: ArtistNameSyncRepository,
  user: UserRecord,
  identitySub: string,
): Promise<void> {
  const userName = normalizeDisplayName(user.name);
  if (!user.cognitoSub || !userName) {
    return;
  }

  const artist = await artistRepository.getArtistByCognitoSub(user.cognitoSub);
  if (!artist) {
    return;
  }

  const nextLocation = String(user.location || "").trim();
  const nextBio = String(user.bio || "").trim();

  if (
    normalizeDisplayName(artist.name) === userName &&
    String(artist.location || "").trim() === nextLocation &&
    String(artist.bio || "").trim() === nextBio
  ) {
    return;
  }

  await artistRepository.patchArtist(
    touchRecordMeta(
      {
        ...artist,
        name: userName,
        location: nextLocation,
        bio: nextBio,
      },
      identitySub,
    ),
  );
}

function normalizeUserPreferences(
  preferences: Partial<UserRecord["preferences"]> | null | undefined,
): UserRecord["preferences"] {
  return {
    bookingUpdates: preferences?.bookingUpdates ?? DEFAULT_USER_PREFERENCES.bookingUpdates,
    messageAlerts: preferences?.messageAlerts ?? DEFAULT_USER_PREFERENCES.messageAlerts,
    marketingEmails: preferences?.marketingEmails ?? DEFAULT_USER_PREFERENCES.marketingEmails,
    browserNotifications: preferences?.browserNotifications ?? DEFAULT_USER_PREFERENCES.browserNotifications,
  };
}

function normalizeUserSetup(user: UserRecord): UserRecord["setup"] {
  if (user.setup) {
    return {
      status: user.setup.status ?? DEFAULT_USER_SETUP.status,
      currentStep: user.setup.currentStep ?? DEFAULT_USER_SETUP.currentStep,
      artistOptIn: user.setup.artistOptIn ?? DEFAULT_USER_SETUP.artistOptIn,
      completedAt: user.setup.completedAt ?? DEFAULT_USER_SETUP.completedAt,
    };
  }

  if (user.profileCompleted) {
    return {
      status: "completed",
      currentStep: "done",
      artistOptIn: false,
      completedAt: user.updatedAt || user.createdAt || null,
    };
  }

  return { ...DEFAULT_USER_SETUP };
}

function normalizeUser(user: UserRecord): UserRecord {
  return {
    ...user,
    bio: String(user.bio || "").trim(),
    preferences: normalizeUserPreferences(user.preferences),
    setup: normalizeUserSetup(user),
  };
}

async function provisionUser(
  repository: UserWorkspaceRepository,
  identity: { sub: string; email: string | null; username: string | null },
): Promise<UserRecord> {
  const meta = createRecordMeta({
    id: `u_${randomUUID()}`,
    createdBy: identity.sub,
  });

  const user = normalizeUser({
    ...meta,
    cognitoSub: identity.sub,
    cognitoEmail: identity.email || "",
    name: displayNameFromIdentity(identity),
    email: identity.email || "",
    location: "",
    bio: "",
    emailVerified: Boolean(identity.email),
    profileCompleted: false,
    preferences: { ...DEFAULT_USER_PREFERENCES },
    setup: { ...DEFAULT_USER_SETUP },
    savedArtistIds: [],
    bookingHistoryIds: [],
    deleted: false,
  });

  await repository.patchUser(user);
  return user;
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
  const normalized = normalizeUser(user);
  return {
    id: normalized.id,
    cognitoSub: normalized.cognitoSub,
    cognitoEmail: normalized.cognitoEmail,
    name: normalized.name,
    email: normalized.email,
    location: normalized.location,
    bio: normalized.bio,
    emailVerified: normalized.emailVerified,
    profileCompleted: normalized.profileCompleted,
    preferences: normalized.preferences,
    setup: normalized.setup,
    savedArtistsCount: normalized.savedArtistIds.length,
    bookingHistoryCount: normalized.bookingHistoryIds.length,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
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
    serviceLabel: booking.serviceLabel || null,
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

async function handleGetMe(
  user: UserRecord,
  artistRepository: ArtistNameSyncRepository,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  await syncArtistProfileFromUser(artistRepository, user, identitySub);
  return json(200, success(mapMe(user)));
}

async function handlePatchProfile(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  artistRepository: ArtistNameSyncRepository,
  user: UserRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{ name?: unknown; location?: unknown; bio?: unknown }>(event, USER_PROFILE_PATCH_SCHEMA);

  const name = normalizeName(payload.name, "name", 80);
  const location = normalizeOptionalText(payload.location, "location", 80);
  const bio = normalizeOptionalText(payload.bio, "bio", 280);
  const setup = normalizeUserSetup(user);

  const next = normalizeUser(touchRecordMeta(
    {
      ...user,
      name,
      location,
      bio,
      profileCompleted: true,
      setup: {
        ...setup,
        status: setup.status === "completed" ? "completed" : "in_progress",
        currentStep: setup.status === "completed" ? "done" : "preferences",
      },
    },
    identitySub,
  ));

  await repository.patchUser(next);
  await syncArtistProfileFromUser(artistRepository, next, identitySub);
  return json(200, success(mapMe(next)));
}

async function handlePatchPreferences(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    bookingUpdates?: unknown;
    messageAlerts?: unknown;
    marketingEmails?: unknown;
    browserNotifications?: unknown;
  }>(event, USER_PREFERENCES_PATCH_SCHEMA);

  const next = normalizeUser(touchRecordMeta(
    {
      ...user,
      preferences: {
        bookingUpdates: Boolean(payload.bookingUpdates),
        messageAlerts: Boolean(payload.messageAlerts),
        marketingEmails: Boolean(payload.marketingEmails),
        browserNotifications: Boolean(payload.browserNotifications),
      },
      setup: {
        ...normalizeUserSetup(user),
        status: normalizeUserSetup(user).status === "completed" ? "completed" : "in_progress",
        currentStep: normalizeUserSetup(user).status === "completed" ? "done" : "artist_prompt",
      },
    },
    identitySub,
  ));

  await repository.patchUser(next);
  return json(200, success(mapMe(next)));
}

async function handlePatchSetup(
  event: APIGatewayProxyEventV2,
  repository: UserWorkspaceRepository,
  user: UserRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    status?: UserRecord["setup"]["status"];
    currentStep?: UserRecord["setup"]["currentStep"];
    artistOptIn?: boolean;
  }>(event, USER_SETUP_PATCH_SCHEMA);

  const existingSetup = normalizeUserSetup(user);
  const next = normalizeUser(touchRecordMeta(
    {
      ...user,
      setup: {
        status: payload.status ?? existingSetup.status,
        currentStep: payload.currentStep ?? existingSetup.currentStep,
        artistOptIn: payload.artistOptIn ?? existingSetup.artistOptIn,
        completedAt:
          (payload.status ?? existingSetup.status) === "completed"
            ? existingSetup.completedAt ?? new Date().toISOString()
            : existingSetup.completedAt,
      },
    },
    identitySub,
  ));

  await repository.patchUser(next);
  return json(200, success(mapMe(next)));
}

async function handleCompleteSetup(
  repository: UserWorkspaceRepository,
  user: UserRecord,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const completedAt = new Date().toISOString();
  const next = normalizeUser(touchRecordMeta(
    {
      ...user,
      profileCompleted: true,
      setup: {
        ...normalizeUserSetup(user),
        status: "completed",
        currentStep: "done",
        completedAt,
      },
    },
    identitySub,
  ));

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
    artistId?: unknown;
    serviceLabel?: unknown;
    deadline?: unknown;
    budget?: unknown;
    message?: unknown;
  }>(event, USER_BOOKING_CREATE_SCHEMA);

  const serviceId = String(payload.serviceId || "").trim() || null;
  const requestedArtistId = String(payload.artistId || "").trim() || null;
  const requestedServiceLabel = normalizeOptionalText(payload.serviceLabel, "serviceLabel", 160);
  const deadline = normalizeDeadline(payload.deadline);
  const budget = normalizeBudget(payload.budget);
  const message = normalizeName(payload.message, "message", 3000);

  let service = null;
  if (serviceId) {
    service = await repository.getServiceById(serviceId);
    if (!service) {
      return json(404, failure("NOT_FOUND", "Service not found."));
    }
  }

  const artistId = service?.artistId || requestedArtistId;
  if (!artistId) {
    throw new RequestError(400, "INVALID_REQUEST", "artistId is required when serviceId is not provided.");
  }

  const artist = await repository.getArtistById(artistId);
  if (!artist) {
    return json(404, failure("NOT_FOUND", "Artist not found."));
  }

  const serviceLabel = service?.title || requestedServiceLabel || artist.category || "Artist profile request";

  const meta = createRecordMeta({
    id: `b_${randomUUID()}`,
    createdBy: identitySub,
  });

  const booking: BookingRecord = {
    ...meta,
    userId: user.id,
    artistId: artist.id,
    serviceId: service?.id || null,
    serviceLabel,
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
    detail: `${user.name} sent a booking request for ${serviceLabel}.`,
    createdBy: identitySub,
  });

  auditLog({
    action: "booking.create",
    actorId: identitySub,
    actorRoles: ["user"],
    resourceType: "booking",
    resourceId: booking.id,
    outcome: "success",
    metadata: {
      artistId: booking.artistId,
      serviceId: booking.serviceId,
      serviceLabel: booking.serviceLabel || null,
      status: booking.status,
    },
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

  const payload = parseBody<{ status?: unknown; note?: unknown }>(event, USER_BOOKING_STATUS_SCHEMA);
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

  auditLog({
    action: "booking.status.update",
    actorId: identitySub,
    actorRoles: ["user"],
    resourceType: "booking",
    resourceId: updated.id,
    outcome: "success",
    metadata: {
      from: booking.status,
      to: updated.status,
    },
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
  repository: UserWorkspaceRepository = new NoopUserWorkspaceRepository(),
  roleAssignmentsRepository: RoleAssignmentsRepository = new NoopRoleAssignmentsRepository(),
  artistRepository: ArtistNameSyncRepository = new NoopArtistWorkspaceRepository(),
) {
  return async function handler(
    event: APIGatewayProxyEventV2,
    ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      enforceRequestSecurity(event, { requireBearerForMutations: true });
      const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
      requireAnyRole(identity, ["user", "admin"]);

      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");
      let user = await repository.getUserByCognitoSub(identity.sub);

      if (!user && (path === "/v1/me" || path.startsWith("/v1/me/") || path === "/v1/bookings" || path.startsWith("/v1/bookings/"))) {
        user = await provisionUser(repository, identity);
      }

      if (!user) {
        return json(404, failure("NOT_FOUND", "User account not found."));
      }

      user = normalizeUser(user);

      if (method === "GET" && path === "/v1/me") {
        return await handleGetMe(user, artistRepository, identity.sub);
      }

      if (method === "PATCH" && path === "/v1/me/profile") {
        return await handlePatchProfile(event, repository, artistRepository, user, identity.sub);
      }

      if (method === "PATCH" && path === "/v1/me/preferences") {
        return await handlePatchPreferences(event, repository, user, identity.sub);
      }

      if (method === "PATCH" && path === "/v1/me/setup") {
        return await handlePatchSetup(event, repository, user, identity.sub);
      }

      if (method === "POST" && path === "/v1/me/setup/complete") {
        return await handleCompleteSetup(repository, user, identity.sub);
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
      if (error instanceof SecurityPolicyError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      if (error instanceof RequestError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      if (error instanceof Error && /Authentication is required/.test(error.message)) {
        return json(401, failure("UNAUTHENTICATED", error.message));
      }

      if (error instanceof Error && /permission/i.test(error.message)) {
        return json(403, failure("FORBIDDEN", error.message));
      }

      console.error("user-api unexpected error", {
        path: event.rawPath,
        method: event.requestContext.http.method,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      });
      return json(500, failure("INTERNAL_ERROR", "Unexpected server error."));
    }
  };
}

let runtimeHandler: ReturnType<typeof createUserApiHandler> | null = null;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  runtimeHandler ||= createUserApiHandler(
    getUserWorkspaceRepository(),
    getRoleAssignmentsRepository(),
    getArtistWorkspaceRepository(),
  );
  return await runtimeHandler(event);
};
