import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { failure, success } from "../domain/api-response.js";
import type {
  ArtistRecord,
  BookingRecord,
  MessageRecord,
  NotificationOwnerRole,
  UserRecord,
} from "../domain/entities.js";
import { createRecordMeta } from "../domain/record-meta.js";
import { json } from "../lib/http.js";
import { type JsonSchema, validateSchema } from "../lib/schema.js";
import { requireAuthIdentity } from "../middleware/auth-context.js";
import { requireAnyRole } from "../middleware/authorization.js";
import { SecurityPolicyError, enforceRequestSecurity } from "../middleware/request-security.js";
import {
  NoopRoleAssignmentsRepository,
  type RoleAssignmentsRepository,
} from "../repos/role-assignments.js";
import {
  NoopMessagingWorkspaceRepository,
  type MessagingWorkspaceRepository,
} from "../repos/messaging-workspace.js";
import { getMessagingWorkspaceRepository, getRoleAssignmentsRepository, getReportWriter, getModerationOptions } from "../repos/runtime.js";
import { moderateText } from "../domain/content-moderation.js";
import { buildAutoModerationReport } from "../domain/auto-report.js";
import { type ReportWriter, NoopReportWriter } from "../repos/report-writer.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_LENGTH = 3000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_MESSAGES = 5;
const THREAD_MESSAGE_CREATE_SCHEMA: JsonSchema = {
  type: "object",
  required: ["body"],
  additionalProperties: true,
  properties: {
    body: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
    toId: { type: "string", maxLength: 80, nullable: true },
    bookingId: { type: "string", maxLength: 80, nullable: true },
  },
};

type PageRequest = {
  limit: number;
  offset: number;
  cursor: string | null;
};

type Participant = {
  id: string;
  role: Extract<NotificationOwnerRole, "user" | "artist">;
  email: string;
  allIds: string[];
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

  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new RequestError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Request payload exceeds ${MAX_REQUEST_BODY_BYTES} bytes limit.`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch (_) {
    throw new RequestError(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  }
}

function parseThreadId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.threadId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/threads\/([^/?#]+)\/messages$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseSince(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }

  const parsed = new Date(raw).getTime();
  if (Number.isNaN(parsed)) {
    throw new RequestError(400, "INVALID_REQUEST", "since must be a valid ISO timestamp.");
  }

  return parsed;
}

function normalizeOptionalText(value: unknown, field: string, max: number): string {
  const trimmed = String(value || "").trim();
  if (trimmed.length > max) {
    throw new RequestError(400, "INVALID_REQUEST", `${field} must be ${max} characters or less.`);
  }

  return trimmed;
}

function normalizeMessageBody(value: unknown): string {
  const body = String(value || "").trim();
  if (!body) {
    throw new RequestError(400, "INVALID_REQUEST", "body is required.");
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new RequestError(400, "INVALID_REQUEST", `body must be ${MAX_MESSAGE_LENGTH} characters or less.`);
  }
  return body;
}

function inferCounterpartyFromBookings(
  participant: Participant,
  booking: BookingRecord,
): string {
  return participant.role === "user" ? booking.artistId : booking.userId;
}

function belongsToThread(message: MessageRecord, participantId: string): boolean {
  return message.fromId === participantId || message.toId === participantId;
}

function mapMessage(message: MessageRecord) {
  return {
    id: message.id,
    threadId: message.threadId,
    bookingId: message.bookingId,
    fromId: message.fromId,
    toId: message.toId,
    body: message.body,
    read: message.read,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function selectCounterparty(participantId: string, message: MessageRecord): string {
  return message.fromId === participantId ? message.toId : message.fromId;
}

async function resolveParticipant(
  repository: MessagingWorkspaceRepository,
  cognitoSub: string,
): Promise<Participant | null> {
  const [user, artist] = await Promise.all([
    repository.getUserByCognitoSub(cognitoSub),
    repository.getArtistByCognitoSub(cognitoSub),
  ]);

  const allIds: string[] = [];
  if (user) allIds.push(user.id);
  if (artist) allIds.push(artist.id);

  if (user) {
    return {
      id: user.id,
      role: "user",
      email: user.email || user.cognitoEmail,
      allIds,
    };
  }

  if (artist) {
    return {
      id: artist.id,
      role: "artist",
      email: artist.cognitoEmail,
      allIds,
    };
  }

  return null;
}

async function listParticipantBookings(
  repository: MessagingWorkspaceRepository,
  participant: Participant,
): Promise<BookingRecord[]> {
  return participant.role === "user"
    ? repository.listBookingsByUserId(participant.id)
    : repository.listBookingsByArtistId(participant.id);
}

function ensureThreadAccess(
  participant: Participant,
  threadId: string,
  threadMessages: MessageRecord[],
  participantBookings: BookingRecord[],
): void {
  // Allow if participant has existing messages in the thread (check all IDs)
  const ids = participant.allIds || [participant.id];
  if (threadMessages.some((item) => ids.some((pid) => belongsToThread(item, pid)))) {
    return;
  }

  // Allow if participant has a booking linked to this thread
  const hasBookingMembership = participantBookings.some((item) => item.threadId === threadId);
  if (hasBookingMembership) {
    return;
  }

  // Allow if any of the participant's IDs (user + artist) are part of the thread ID
  if (ids.some((pid) => threadId.includes(pid))) {
    return;
  }

  throw new RequestError(403, "FORBIDDEN", "You do not have permission to access this thread.");
}

function resolveRecipientId(args: {
  participant: Participant;
  threadId: string;
  threadMessages: MessageRecord[];
  participantBookings: BookingRecord[];
  payloadRecipientId: string;
}): string {
  const payloadRecipientId = args.payloadRecipientId;
  const { participant, threadMessages, participantBookings, threadId } = args;

  if (payloadRecipientId) {
    if (payloadRecipientId === participant.id) {
      throw new RequestError(400, "INVALID_REQUEST", "toId cannot be the same as fromId.");
    }

    if (threadMessages.length) {
      const validIds = new Set<string>();
      threadMessages.forEach((item) => {
        validIds.add(item.fromId);
        validIds.add(item.toId);
      });

      if (!validIds.has(payloadRecipientId)) {
        throw new RequestError(
          400,
          "INVALID_REQUEST",
          "toId must belong to participants already in the thread.",
        );
      }
    }

    if (!threadMessages.length) {
      const booking = participantBookings.find((item) => item.threadId === threadId);
      if (booking) {
        const expectedCounterparty = inferCounterpartyFromBookings(participant, booking);
        if (expectedCounterparty !== payloadRecipientId) {
          throw new RequestError(
            400,
            "INVALID_REQUEST",
            "toId does not match booking participants for this thread.",
          );
        }
      }
    }

    return payloadRecipientId;
  }

  if (threadMessages.length) {
    const latest = [...threadMessages].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    return selectCounterparty(participant.id, latest);
  }

  const booking = participantBookings.find((item) => item.threadId === threadId);
  if (booking) {
    return inferCounterpartyFromBookings(participant, booking);
  }

  throw new RequestError(400, "INVALID_REQUEST", "toId is required for new thread messages.");
}

function enforceRateLimit(
  threadMessages: MessageRecord[],
  participantId: string,
): void {
  const now = Date.now();
  const sentRecently = threadMessages.filter((message) => {
    if (message.fromId !== participantId) {
      return false;
    }

    const createdAt = new Date(message.createdAt).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= RATE_LIMIT_WINDOW_MS;
  });

  if (sentRecently.length >= RATE_LIMIT_MAX_MESSAGES) {
    throw new RequestError(
      429,
      "RATE_LIMITED",
      `Too many messages sent in a short period. Try again later.`,
    );
  }
}

async function handleGetThreads(
  event: APIGatewayProxyEventV2,
  repository: MessagingWorkspaceRepository,
  participant: Participant,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const messages = await repository.listMessagesByParticipantId(participant.id);
  const bookings = await listParticipantBookings(repository, participant);

  const threadIds = new Set<string>([
    ...messages.map((message) => message.threadId),
    ...bookings.map((booking) => booking.threadId),
  ]);

  const threadSummaries = Array.from(threadIds).map((threadId) => {
    const threadMessages = messages
      .filter((message) => message.threadId === threadId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const threadBooking = bookings.find((booking) => booking.threadId === threadId);
    const latestMessage = threadMessages[0] || null;

    const updatedAt = latestMessage?.createdAt || threadBooking?.updatedAt || threadBooking?.createdAt;

    const unreadCount = threadMessages.filter(
      (message) => message.toId === participant.id && !message.read,
    ).length;

    const counterpartId = latestMessage
      ? selectCounterparty(participant.id, latestMessage)
      : threadBooking
        ? inferCounterpartyFromBookings(participant, threadBooking)
        : null;

    return {
      id: threadId,
      bookingId: threadBooking?.id || latestMessage?.bookingId || null,
      counterpartId,
      unreadCount,
      latestMessage: latestMessage
        ? {
            id: latestMessage.id,
            fromId: latestMessage.fromId,
            body: latestMessage.body,
            createdAt: latestMessage.createdAt,
          }
        : null,
      updatedAt,
    };
  });

  const sorted = threadSummaries.sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime(),
  );
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items,
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handleGetThreadMessages(
  event: APIGatewayProxyEventV2,
  repository: MessagingWorkspaceRepository,
  participant: Participant,
): Promise<APIGatewayProxyStructuredResultV2> {
  const threadId = parseThreadId(event);
  if (!threadId) {
    throw new RequestError(400, "INVALID_REQUEST", "threadId is required.");
  }

  const page = parsePage(event.queryStringParameters);
  const participantBookings = await listParticipantBookings(repository, participant);
  const threadMessages = await repository.listMessagesByThreadId(threadId);

  ensureThreadAccess(participant, threadId, threadMessages, participantBookings);

  const sorted = [...threadMessages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      threadId,
      items: paged.items.map(mapMessage),
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handlePostThreadMessage(
  event: APIGatewayProxyEventV2,
  repository: MessagingWorkspaceRepository,
  participant: Participant,
  identitySub: string,
  reportWriter: ReportWriter,
): Promise<APIGatewayProxyStructuredResultV2> {
  const threadId = parseThreadId(event);
  if (!threadId) {
    throw new RequestError(400, "INVALID_REQUEST", "threadId is required.");
  }

  const payload = parseBody<{ body?: unknown; toId?: unknown; bookingId?: unknown }>(event);
  const issues = validateSchema(THREAD_MESSAGE_CREATE_SCHEMA, payload, "body");
  if (issues.length) {
    throw new RequestError(400, "INVALID_REQUEST", issues[0]);
  }

  const messageBody = normalizeMessageBody(payload.body);
  const payloadRecipientId = normalizeOptionalText(payload.toId, "toId", 80);
  const bookingId = normalizeOptionalText(payload.bookingId, "bookingId", 80) || undefined;

  const participantBookings = await listParticipantBookings(repository, participant);
  const threadMessages = await repository.listMessagesByThreadId(threadId);

  ensureThreadAccess(participant, threadId, threadMessages, participantBookings);

  const toId = resolveRecipientId({
    participant,
    threadId,
    threadMessages,
    participantBookings,
    payloadRecipientId,
  });

  const meta = createRecordMeta({
    id: `m_${randomUUID()}`,
    createdBy: identitySub,
  });

  const message: MessageRecord = {
    ...meta,
    threadId,
    bookingId,
    fromId: participant.id,
    toId,
    body: messageBody,
    read: false,
  };

  await repository.createMessage(message);

  return json(201, success(mapMessage(message)));
}

async function handleGetUpdates(
  event: APIGatewayProxyEventV2,
  repository: MessagingWorkspaceRepository,
  participant: Participant,
): Promise<APIGatewayProxyStructuredResultV2> {
  const sinceMs = parseSince(event.queryStringParameters?.since);

  const [bookings, messages, notifications] = await Promise.all([
    listParticipantBookings(repository, participant),
    repository.listMessagesByParticipantId(participant.id),
    repository.listNotificationsByOwner(participant.role, participant.id),
  ]);

  const bookingDeltas = bookings
    .filter((item) => new Date(item.updatedAt).getTime() > sinceMs)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((item) => ({
      id: item.id,
      threadId: item.threadId,
      status: item.status,
      updatedAt: item.updatedAt,
    }));

  const messageDeltas = messages
    .filter((item) => new Date(item.createdAt).getTime() > sinceMs)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const latestMessage = messageDeltas[0] || null;

  const unreadMessages = messages.filter(
    (item) => item.toId === participant.id && !item.read,
  ).length;

  const unreadNotifications = notifications.filter((item) => !item.read).length;

  return json(
    200,
    success({
      since: sinceMs ? new Date(sinceMs).toISOString() : null,
      unread: {
        messages: unreadMessages,
        notifications: unreadNotifications,
      },
      bookingDeltas,
      latestMessageSnippet: latestMessage
        ? {
            threadId: latestMessage.threadId,
            messageId: latestMessage.id,
            body: latestMessage.body.slice(0, 160),
            fromId: latestMessage.fromId,
            createdAt: latestMessage.createdAt,
          }
        : null,
      serverTime: new Date().toISOString(),
    }),
  );
}

export function createMessagingApiHandler(
  repository: MessagingWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository = new NoopRoleAssignmentsRepository(),
  reportWriter: ReportWriter = new NoopReportWriter(),
) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      enforceRequestSecurity(event, { requireBearerForMutations: true });
      const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
      requireAnyRole(identity, ["user", "artist", "admin"]);

      const participant = await resolveParticipant(repository, identity.sub);
      if (!participant) {
        return json(404, failure("NOT_FOUND", "Messaging account not found."));
      }

      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      if (method === "GET" && path === "/v1/threads") {
        return await handleGetThreads(event, repository, participant);
      }

      if (method === "GET" && /^\/v1\/threads\/[^/]+\/messages$/.test(path)) {
        return await handleGetThreadMessages(event, repository, participant);
      }

      if (method === "POST" && /^\/v1\/threads\/[^/]+\/messages$/.test(path)) {
        return await handlePostThreadMessage(event, repository, participant, identity.sub, reportWriter);
      }

      if (method === "GET" && path === "/v1/me/updates") {
        return await handleGetUpdates(event, repository, participant);
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

      return json(500, failure("INTERNAL_ERROR", "Unexpected server error."));
    }
  };
}

let runtimeHandler: ReturnType<typeof createMessagingApiHandler> | null = null;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  runtimeHandler ||= createMessagingApiHandler(getMessagingWorkspaceRepository(), getRoleAssignmentsRepository(), getReportWriter());
  return await runtimeHandler(event);
};
