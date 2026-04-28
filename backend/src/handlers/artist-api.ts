import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { detectAiText } from "../domain/ai-detection.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { loadEnv } from "../lib/env.js";
import { getArtistPublishSummary } from "../domain/artist-publishing.js";
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
import { auditLog } from "../lib/audit.js";
import { json } from "../lib/http.js";
import { type JsonSchema, parseJsonRequestBody, validateSchema } from "../lib/schema.js";
import { requireAuthIdentity } from "../middleware/auth-context.js";
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
import { getArtistWorkspaceRepository, getReportWriter, getRoleAssignmentsRepository, getModerationOptions } from "../repos/runtime.js";
import { moderateText, type ModerationOptions } from "../domain/content-moderation.js";
import { buildAutoModerationReport } from "../domain/auto-report.js";
import { type ReportWriter, NoopReportWriter } from "../repos/report-writer.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const AVAILABILITY_VALUES = ["open", "limited", "unavailable"] as const;
const ARTIST_PROFILE_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80, nullable: true },
    handle: { type: "string", minLength: 1, maxLength: 60, nullable: true },
    category: { type: "string", maxLength: 80, nullable: true },
    mediums: { type: "array", maxItems: 16, nullable: true },
    priceFrom: { type: "number", minimum: 0, nullable: true },
    location: { type: "string", maxLength: 80, nullable: true },
    bio: { type: "string", maxLength: 1200, nullable: true },
    availability: { type: "string", enum: AVAILABILITY_VALUES, nullable: true },
    profileVisible: { type: "boolean", nullable: true },
  },
};
const ARTIST_ONBOARDING_SCHEMA: JsonSchema = {
  type: "object",
  required: ["category", "mediums", "priceFrom", "availability"],
  additionalProperties: true,
  properties: {
    category: { type: "string", minLength: 1, maxLength: 80 },
    mediums: { type: "array", minItems: 1, maxItems: 16 },
    priceFrom: { type: "number", minimum: 0.01 },
    availability: { type: "string", enum: AVAILABILITY_VALUES },
    portfolio: { type: "array", maxItems: 40, nullable: true },
    bio: { type: "string", maxLength: 1200, nullable: true },
    profileVisible: { type: "boolean", nullable: true },
  },
};
const ARTIST_SERVICE_CREATE_SCHEMA: JsonSchema = {
  type: "object",
  required: ["title", "description", "price", "deliveryDays"],
  additionalProperties: true,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 2000 },
    price: { type: "number", minimum: 0.01 },
    deliveryDays: { type: "integer", minimum: 1, maximum: 365 },
  },
};
const ARTIST_SERVICE_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120, nullable: true },
    description: { type: "string", minLength: 1, maxLength: 2000, nullable: true },
    price: { type: "number", minimum: 0.01, nullable: true },
    deliveryDays: { type: "integer", minimum: 1, maximum: 365, nullable: true },
  },
};
const ARTIST_BOOKING_DECISION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    note: { type: "string", maxLength: 500, nullable: true },
  },
};

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
    return "Artist";
  }

  return fromEmail;
}

function slugify(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeArtist(artist: ArtistRecord): ArtistRecord {
  return {
    ...artist,
    handle: slugify(artist.handle) || artist.handle,
    profileVisible: Boolean(artist.profileVisible),
  };
}

async function provisionArtist(
  repository: ArtistWorkspaceRepository,
  identity: { sub: string; email: string | null; username: string | null },
): Promise<ArtistRecord> {
  const meta = createRecordMeta({
    id: `a_${randomUUID()}`,
    createdBy: identity.sub,
  });

  const displayName = displayNameFromIdentity(identity);
  let handle = slugify(displayName) || "artist";

  // Ensure unique handle — append suffix if taken
  const baseHandle = handle;
  for (let suffix = 1; suffix <= 99; suffix++) {
    const taken = await repository.isHandleTaken(handle, meta.id);
    if (!taken) break;
    handle = `${baseHandle}-${suffix}`;
  }

  const artist = normalizeArtist({
    ...meta,
    cognitoSub: identity.sub,
    cognitoEmail: identity.email || "",
    name: displayName,
    handle,
    category: "",
    mediums: [],
    location: "",
    verified: false,
    popularity: 0,
    rating: 0,
    reviewCount: 0,
    priceFrom: 0,
    availability: "open",
    bio: "",
    profileVisible: false,
    profileViews: 0,
    completedBookings: 0,
    acceptanceRate: 0,
    portfolio: [],
  });

  await repository.patchArtist(artist);
  return artist;
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

function normalizeDraftStringArray(value: unknown, field: string, maxItems = 16, maxLength = 60): string[] {
  if (!Array.isArray(value)) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be an array.`);
  }

  if (value.length > maxItems) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} cannot include more than ${maxItems} items.`);
  }

  const items = value
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  items.forEach((item) => {
    if (item.length > maxLength) {
      throw new RequestError(400, "INVALID_REQUEST", `${field} items must be ${maxLength} characters or less.`);
    }
  });

  return Array.from(new Set(items));
}

function normalizeDraftMoney(value: unknown, field: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be a number greater than or equal to 0.`);
  }

  return Math.round(numeric * 100) / 100;
}

function publishingRequirementsMessage(summary: ReturnType<typeof getArtistPublishSummary>): string {
  if (!summary.publishMissingFields.length) {
    return "Complete the profile before publishing.";
  }

  return `Complete ${summary.publishMissingFields.join(", ")} before publishing.`;
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
  const normalized = normalizeArtist(artist);
  const publishSummary = getArtistPublishSummary(normalized);
  return {
    id: normalized.id,
    cognitoSub: normalized.cognitoSub,
    cognitoEmail: normalized.cognitoEmail,
    name: normalized.name,
    handle: normalized.handle,
    category: normalized.category,
    mediums: normalized.mediums,
    location: normalized.location,
    verified: normalized.verified,
    popularity: normalized.popularity,
    rating: normalized.rating,
    reviewCount: normalized.reviewCount,
    priceFrom: normalized.priceFrom,
    availability: normalized.availability,
    bio: normalized.bio,
    profileVisible: normalized.profileVisible,
    publishState: publishSummary.publishState,
    publishReady: publishSummary.publishReady,
    publishMissingFields: publishSummary.publishMissingFields,
    profileViews: normalized.profileViews,
    completedBookings: normalized.completedBookings,
    acceptanceRate: normalized.acceptanceRate,
    portfolio: normalized.portfolio,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
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
  reportWriter: ReportWriter,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    name?: unknown;
    handle?: unknown;
    category?: unknown;
    mediums?: unknown;
    priceFrom?: unknown;
    location?: unknown;
    bio?: unknown;
    availability?: unknown;
    profileVisible?: unknown;
  }>(event, ARTIST_PROFILE_PATCH_SCHEMA);

  // Lock profile edits after verification — only allow visibility and availability changes
  if (artist.verified) {
    const lockedFields = ["name", "handle", "category", "mediums", "priceFrom", "bio", "location"];
    const attemptedLocked = lockedFields.filter((f) => payload[f as keyof typeof payload] !== undefined);
    if (attemptedLocked.length > 0) {
      throw new RequestError(400, "PROFILE_LOCKED", "Your profile has been verified and cannot be edited. Contact support if you need changes.");
    }
  }

  const patchName = normalizeRequiredText(payload.name ?? artist.name, "name", 80);
  const patchBio = normalizeOptionalText(payload.bio ?? artist.bio, "bio", 1200);

  const modOptions = await getModerationOptions();
  const modVerdict = moderateText([
    { name: "name", value: patchName },
    { name: "bio", value: patchBio },
  ], modOptions);
  if (!modVerdict.allowed) {
    throw new RequestError(400, "CONTENT_BLOCKED", "Your profile contains prohibited language. Please revise and try again.");
  }
  if (modVerdict.flagged) {
    const report = buildAutoModerationReport({ targetId: artist.id, verdict: modVerdict, handler: "artist-api/profile", contentSnapshot: `name=${patchName}; bio=${patchBio}` });
    await reportWriter.createReport(report).catch(() => {});
  }

  // AI detection on bio text
  const aiCheck = detectAiText(patchBio);
  if (aiCheck.flagged) {
    const aiReport = buildAutoModerationReport({
      targetId: artist.id,
      verdict: { allowed: true, flagged: true, reasons: aiCheck.reasons.map((r) => ({ rule: "ai_detection", severity: "flag" as const, field: "bio", detail: r })) },
      handler: "artist-api/ai-detection",
      contentSnapshot: `bio=${patchBio}; confidence=${aiCheck.confidence.toFixed(2)}`,
    });
    await reportWriter.createReport(aiReport).catch(() => {});
  }

  const newHandle = slugify(normalizeRequiredText(payload.handle ?? artist.handle, "handle", 60));
  if (newHandle && newHandle !== artist.handle) {
    const taken = await repository.isHandleTaken(newHandle, artist.id);
    if (taken) {
      throw new RequestError(400, "HANDLE_TAKEN", `The handle "${newHandle}" is already taken. Please choose a different one.`);
    }
  }

  const next = normalizeArtist(touchRecordMeta(
    {
      ...artist,
      name: normalizeRequiredText(payload.name ?? artist.name, "name", 80),
      handle: newHandle || artist.handle,
      category: payload.category == null
        ? artist.category
        : normalizeOptionalText(payload.category, "category", 80),
      mediums: payload.mediums == null
        ? artist.mediums
        : normalizeDraftStringArray(payload.mediums, "mediums", 16, 60),
      priceFrom: payload.priceFrom == null
        ? artist.priceFrom
        : normalizeDraftMoney(payload.priceFrom, "priceFrom"),
      location: normalizeOptionalText(payload.location ?? artist.location, "location", 80),
      bio: normalizeOptionalText(payload.bio ?? artist.bio, "bio", 1200),
      availability: payload.availability
        ? normalizeAvailability(payload.availability)
        : artist.availability,
      profileVisible:
        payload.profileVisible == null
          ? artist.profileVisible
          : Boolean(payload.profileVisible),
    },
    identitySub,
  ));

  const publishSummary = getArtistPublishSummary(next);
  if (payload.profileVisible === true && !publishSummary.publishReady) {
    throw new RequestError(400, "INVALID_REQUEST", publishingRequirementsMessage(publishSummary));
  }

  if (!publishSummary.publishReady) {
    next.profileVisible = false;
  }

  await repository.patchArtist(next);
  return json(200, success(mapArtist(next)));
}

async function handlePutOnboarding(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
  identitySub: string,
  reportWriter: ReportWriter,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    category?: unknown;
    mediums?: unknown;
    priceFrom?: unknown;
    availability?: unknown;
    portfolio?: unknown;
    bio?: unknown;
    profileVisible?: unknown;
  }>(event, ARTIST_ONBOARDING_SCHEMA);

  const onboardingBio = normalizeOptionalText(payload.bio ?? artist.bio, "bio", 1200);

  const modOptions = await getModerationOptions();
  const modVerdict = moderateText([
    { name: "bio", value: onboardingBio },
    { name: "category", value: String(payload.category || "") },
  ], modOptions);
  if (!modVerdict.allowed) {
    throw new RequestError(400, "CONTENT_BLOCKED", "Your profile contains prohibited language. Please revise and try again.");
  }
  if (modVerdict.flagged) {
    const report = buildAutoModerationReport({ targetId: artist.id, verdict: modVerdict, handler: "artist-api/onboarding", contentSnapshot: `bio=${onboardingBio}` });
    await reportWriter.createReport(report).catch(() => {});
  }

  const aiCheck = detectAiText(onboardingBio);
  if (aiCheck.flagged) {
    const aiReport = buildAutoModerationReport({
      targetId: artist.id,
      verdict: { allowed: true, flagged: true, reasons: aiCheck.reasons.map((r) => ({ rule: "ai_detection", severity: "flag" as const, field: "bio", detail: r })) },
      handler: "artist-api/ai-detection",
      contentSnapshot: `bio=${onboardingBio}; confidence=${aiCheck.confidence.toFixed(2)}`,
    });
    await reportWriter.createReport(aiReport).catch(() => {});
  }

  const next = normalizeArtist(touchRecordMeta(
    {
      ...artist,
      category: normalizeRequiredText(payload.category, "category", 80),
      mediums: normalizeStringArray(payload.mediums, "mediums", 16, 60),
      priceFrom: normalizeMoney(payload.priceFrom, "priceFrom"),
      availability: normalizeAvailability(payload.availability),
      portfolio: normalizePortfolio(payload.portfolio),
      bio: onboardingBio,
      profileVisible:
        payload.profileVisible == null
          ? artist.profileVisible
          : Boolean(payload.profileVisible),
    },
    identitySub,
  ));

  const publishSummary = getArtistPublishSummary(next);
  if (payload.profileVisible === true && !publishSummary.publishReady) {
    throw new RequestError(400, "INVALID_REQUEST", publishingRequirementsMessage(publishSummary));
  }

  if (!publishSummary.publishReady) {
    next.profileVisible = false;
  }

  await repository.patchArtist(next);
  return json(200, success(mapArtist(next)));
}

async function handleCreateService(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
  identitySub: string,
  reportWriter: ReportWriter,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{
    title?: unknown;
    description?: unknown;
    price?: unknown;
    deliveryDays?: unknown;
  }>(event, ARTIST_SERVICE_CREATE_SCHEMA);

  const meta = createRecordMeta({
    id: `s_${randomUUID()}`,
    createdBy: identitySub,
  });

  const serviceTitle = normalizeRequiredText(payload.title, "title", 120);
  const serviceDesc = normalizeRequiredText(payload.description, "description", 2000);

  const service: ServiceRecord = {
    ...meta,
    artistId: artist.id,
    title: serviceTitle,
    description: serviceDesc,
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
  reportWriter: ReportWriter,
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
  }>(event, ARTIST_SERVICE_PATCH_SCHEMA);

  const updatedTitle = payload.title == null ? existing.title : normalizeRequiredText(payload.title, "title", 120);
  const updatedDesc = payload.description == null ? existing.description : normalizeRequiredText(payload.description, "description", 2000);

  const next = touchRecordMeta(
    {
      ...existing,
      title: updatedTitle,
      description: updatedDesc,
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

  const payload = parseBody<{ note?: unknown }>(event, ARTIST_BOOKING_DECISION_SCHEMA);
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

  auditLog({
    action: "booking.status.update",
    actorId: identitySub,
    actorRoles: ["artist"],
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

async function handleGetArtistNotifications(
  event: APIGatewayProxyEventV2,
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const all = await repository.listNotificationsByOwner("artist", artist.id);
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

async function handleMarkArtistNotificationsRead(
  repository: ArtistWorkspaceRepository,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const updatedCount = await repository.markNotificationsRead("artist", artist.id);
  return json(200, success({ updatedCount }));
}

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // HEIF/HEIC — iPhone and modern camera format, supported in all modern browsers
  "image/heif",
  "image/heic",
  "image/heif-sequence",
  "image/heic-sequence",
  // CR3 — Canon RAW 3. Stored as-is; note that browsers cannot render raw
  // files inline so the portfolio image will show a broken icon until a
  // web-viewable version (JPG/HEIC) is used instead.
  "image/x-canon-cr3",
];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heif": "heif",
  "image/heic": "heic",
  "image/heif-sequence": "heif",
  "image/heic-sequence": "heic",
  "image/x-canon-cr3": "cr3",
};
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20 MB — covers HEIC/HEIF and RAW files
let s3Client: S3Client | null = null;

async function handleGetUploadUrl(
  event: APIGatewayProxyEventV2,
  artist: ArtistRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  const env = loadEnv();
  if (!env.uploadsBucketName) {
    return json(503, failure("NOT_CONFIGURED", "Image uploads are not configured."));
  }

  const payload = parseJsonRequestBody(event) as Record<string, unknown>;
  const contentType = String(payload?.contentType || "").trim();
  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    return json(400, failure("INVALID_REQUEST", "contentType must be image/jpeg, image/png, image/webp, image/heic, image/heif, or image/x-canon-cr3."));
  }

  if (!s3Client) {
    s3Client = new S3Client({ region: env.awsRegion });
  }

  const ext = EXT_MAP[contentType] || "jpg";
  const key = `portfolio/${artist.id}/${randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: env.uploadsBucketName,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  const publicUrl = `https://${env.uploadsBucketName}.s3.${env.awsRegion}.amazonaws.com/${key}`;

  return json(200, success({ uploadUrl, publicUrl, key, expiresIn: 300 }));
}

export function createArtistApiHandler(
  repository: ArtistWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository = new NoopRoleAssignmentsRepository(),
  reportWriter: ReportWriter = new NoopReportWriter(),
) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      enforceRequestSecurity(event, { requireBearerForMutations: true });
      const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
      requireAnyRole(identity, ["artist", "admin"]);
      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      let artist = await repository.getArtistByCognitoSub(identity.sub);
      if (!artist && path.startsWith("/v1/artist/me")) {
        artist = await provisionArtist(repository, identity);
      }

      if (!artist) {
        return json(404, failure("NOT_FOUND", "Artist account not found."));
      }

      artist = normalizeArtist(artist);

      if (method === "GET" && path === "/v1/artist/me") {
        return await handleGetArtistMe(repository, artist);
      }

      if (method === "PATCH" && path === "/v1/artist/me/profile") {
        return await handlePatchArtistProfile(event, repository, artist, identity.sub, reportWriter);
      }

      if (method === "PUT" && path === "/v1/artist/me/onboarding") {
        return await handlePutOnboarding(event, repository, artist, identity.sub, reportWriter);
      }

      if (method === "POST" && path === "/v1/artist/me/services") {
        return await handleCreateService(event, repository, artist, identity.sub, reportWriter);
      }

      if (method === "PATCH" && path.startsWith("/v1/artist/me/services/")) {
        return await handleUpdateService(event, repository, artist, identity.sub, reportWriter);
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

      if (method === "GET" && path === "/v1/artist/me/notifications") {
        return await handleGetArtistNotifications(event, repository, artist);
      }

      if (method === "POST" && path === "/v1/artist/me/notifications/read-all") {
        return await handleMarkArtistNotificationsRead(repository, artist);
      }

      if (method === "POST" && path === "/v1/artist/me/upload-url") {
        return await handleGetUploadUrl(event, artist);
      }

      if (method === "GET" && path === "/v1/artist/me/subscription") {
        const sub = artist.subscription || { status: "none", plan: "creator", monthlyFee: 20, monthlyEarnings: 0, creditBalance: 0 };
        const creditEligible = sub.monthlyEarnings >= 100;
        return json(200, success({ ...sub, creditEligible }));
      }

      if (method === "POST" && path === "/v1/artist/me/subscription/activate") {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        const sub = {
          status: "active" as const,
          plan: "creator",
          monthlyFee: 20,
          activatedAt: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          monthlyEarnings: artist.subscription?.monthlyEarnings || 0,
          creditBalance: artist.subscription?.creditBalance || 0,
        };
        const next = touchRecordMeta({ ...artist, subscription: sub }, identity.sub);
        await repository.patchArtist(next);
        return json(200, success(sub));
      }

      if (method === "POST" && path === "/v1/artist/me/subscription/cancel") {
        const sub = { ...(artist.subscription || { status: "none" as const, plan: "creator", monthlyFee: 20, monthlyEarnings: 0, creditBalance: 0 }), status: "cancelled" as const };
        const next = touchRecordMeta({ ...artist, subscription: sub }, identity.sub);
        await repository.patchArtist(next);
        return json(200, success(sub));
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

      console.error("artist-api unexpected error", {
        path: event.rawPath,
        method: event.requestContext.http.method,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      });
      return json(500, failure("INTERNAL_ERROR", "Unexpected server error."));
    }
  };
}

let runtimeHandler: ReturnType<typeof createArtistApiHandler> | null = null;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  runtimeHandler ||= createArtistApiHandler(getArtistWorkspaceRepository(), getRoleAssignmentsRepository(), getReportWriter());
  return await runtimeHandler(event);
};
