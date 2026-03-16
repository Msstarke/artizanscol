import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { failure, success } from "../domain/api-response.js";
import type {
  ArtistRecord,
  CategoryRecord,
  ReportRecord,
  ReportStatus,
  ReportType,
  SystemConfigRecord,
} from "../domain/entities.js";
import { categoryActiveStatus, categorySortName } from "../domain/index-keys.js";
import { createRecordMeta, touchRecordMeta } from "../domain/record-meta.js";
import { auditLog } from "../lib/audit.js";
import { json } from "../lib/http.js";
import { type JsonSchema, parseJsonRequestBody, validateSchema } from "../lib/schema.js";
import { requireAuthIdentity } from "../middleware/auth-context.js";
import { requireAdmin } from "../middleware/authorization.js";
import { SecurityPolicyError, enforceRequestSecurity } from "../middleware/request-security.js";
import {
  NoopRoleAssignmentsRepository,
  type RoleAssignmentsRepository,
} from "../repos/role-assignments.js";
import {
  NoopAdminWorkspaceRepository,
  type AdminWorkspaceRepository,
} from "../repos/admin-workspace.js";
import { getAdminWorkspaceRepository, getRoleAssignmentsRepository } from "../repos/runtime.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const REPORT_TYPES = ["spam", "abuse", "copyright", "ai"] as const;
const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
const SYSTEM_CONFIG_ID = "system";
const ADMIN_REVIEW_NOTE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    note: { type: "string", maxLength: 500, nullable: true },
  },
};
const ADMIN_REPORT_STATUS_SCHEMA: JsonSchema = {
  type: "object",
  required: ["status"],
  additionalProperties: true,
  properties: {
    status: { type: "string", enum: REPORT_STATUSES },
    note: { type: "string", maxLength: 1000, nullable: true },
  },
};
const ADMIN_CATEGORY_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80, nullable: true },
    active: { type: "boolean", nullable: true },
  },
};
const ADMIN_USER_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["deleted"],
  additionalProperties: true,
  properties: {
    deleted: { type: "boolean" },
    note: { type: "string", maxLength: 500, nullable: true },
  },
};
const ADMIN_MAINTENANCE_PATCH_SCHEMA: JsonSchema = {
  type: "object",
  required: ["maintenanceMode"],
  additionalProperties: true,
  properties: {
    maintenanceMode: { type: "boolean" },
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

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new RequestError(400, "INVALID_REQUEST", `${field} must be true or false.`);
}

function parseArtistId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.artistId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/admin\/artists\/([^/?#]+)\/(verify|reject)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseUserId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.userId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/admin\/platform\/users\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseReportId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.reportId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/admin\/reports\/([^/?#]+)\/status$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseCategoryId(event: APIGatewayProxyEventV2): string | null {
  const fromParams = String(event.pathParameters?.categoryId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const match = String(event.rawPath || "").match(/^\/v1\/admin\/platform\/categories\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseReportType(raw: string | undefined): ReportType | null {
  if (!raw) {
    return null;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (!REPORT_TYPES.includes(normalized as ReportType)) {
    throw new RequestError(400, "INVALID_REQUEST", `type must be one of: ${REPORT_TYPES.join(", ")}.`);
  }

  return normalized as ReportType;
}

function parseReportStatus(raw: string | undefined): ReportStatus | null {
  if (!raw) {
    return null;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (!REPORT_STATUSES.includes(normalized as ReportStatus)) {
    throw new RequestError(
      400,
      "INVALID_REQUEST",
      `status must be one of: ${REPORT_STATUSES.join(", ")}.`,
    );
  }

  return normalized as ReportStatus;
}

function mapArtistModeration(artist: ArtistRecord) {
  return {
    id: artist.id,
    name: artist.name,
    handle: artist.handle,
    category: artist.category,
    location: artist.location,
    verified: artist.verified,
    reviewCount: artist.reviewCount,
    rating: artist.rating,
    createdAt: artist.createdAt,
    updatedAt: artist.updatedAt,
  };
}

function mapReport(report: ReportRecord) {
  return {
    id: report.id,
    type: report.type,
    status: report.status,
    targetId: report.targetId,
    reportedById: report.reportedById,
    note: report.note,
    resolvedById: report.resolvedById || null,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function mapUser(user: { id: string; name: string; email: string; location: string; deleted: boolean; createdAt: string; updatedAt: string }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    location: user.location,
    deleted: user.deleted,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function mapCategory(category: CategoryRecord) {
  return {
    id: category.id,
    name: category.name,
    sortName: category.sortName,
    active: category.active,
    activeStatus: category.activeStatus,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

async function resolveSystemConfig(
  repository: AdminWorkspaceRepository,
  identitySub: string,
): Promise<SystemConfigRecord> {
  const existing = await repository.getSystemConfig();
  if (existing) {
    return existing;
  }

  const created: SystemConfigRecord = {
    ...createRecordMeta({
      id: SYSTEM_CONFIG_ID,
      createdBy: identitySub,
    }),
    maintenanceMode: false,
    errorLog: [],
  };

  await repository.putSystemConfig(created);
  return created;
}

async function handleGetArtistsReview(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const verifiedFilterRaw = event.queryStringParameters?.verified;

  const verifiedFilter = verifiedFilterRaw == null
    ? null
    : parseBoolean(verifiedFilterRaw, "verified");

  const artists = await repository.listArtists();
  const filtered = verifiedFilter == null
    ? artists
    : artists.filter((artist) => artist.verified === verifiedFilter);

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items.map(mapArtistModeration),
      summary: {
        total: artists.length,
        pending: artists.filter((artist) => !artist.verified).length,
        verified: artists.filter((artist) => artist.verified).length,
      },
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handleVerifyOrRejectArtist(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
  identitySub: string,
  action: "verify" | "reject",
): Promise<APIGatewayProxyStructuredResultV2> {
  const artistId = parseArtistId(event);
  if (!artistId) {
    throw new RequestError(400, "INVALID_REQUEST", "artistId is required.");
  }

  const artist = await repository.getArtistById(artistId);
  if (!artist) {
    return json(404, failure("NOT_FOUND", "Artist not found."));
  }

  const payload = parseBody<{ note?: unknown }>(event, ADMIN_REVIEW_NOTE_SCHEMA);
  const note = normalizeOptionalText(payload.note, "note", 500);

  const next = touchRecordMeta(
    {
      ...artist,
      verified: action === "verify",
      bio: action === "reject" && note
        ? `${artist.bio}\n\n[Admin note] ${note}`.trim()
        : artist.bio,
    },
    identitySub,
  );

  await repository.patchArtist(next);
  auditLog({
    action: action === "verify" ? "admin.artist.verify" : "admin.artist.reject",
    actorId: identitySub,
    actorRoles: ["admin"],
    resourceType: "artist",
    resourceId: next.id,
    outcome: "success",
    metadata: {
      note: note || null,
      previousVerified: artist.verified,
      nextVerified: next.verified,
    },
  });

  return json(
    200,
    success({
      action,
      note: note || null,
      artist: mapArtistModeration(next),
    }),
  );
}

async function handleGetReports(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const status = parseReportStatus(event.queryStringParameters?.status);
  const type = parseReportType(event.queryStringParameters?.type);

  const reports = await repository.listReports();
  const filtered = reports.filter((report) => {
    if (status && report.status !== status) {
      return false;
    }
    if (type && report.type !== type) {
      return false;
    }
    return true;
  });

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  const byStatus = REPORT_STATUSES.reduce<Record<ReportStatus, number>>(
    (acc, key) => {
      acc[key] = reports.filter((report) => report.status === key).length;
      return acc;
    },
    {
      open: 0,
      reviewing: 0,
      resolved: 0,
      dismissed: 0,
    },
  );

  return json(
    200,
    success({
      items: paged.items.map(mapReport),
      summary: {
        total: reports.length,
        byStatus,
      },
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handleUpdateReportStatus(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const reportId = parseReportId(event);
  if (!reportId) {
    throw new RequestError(400, "INVALID_REQUEST", "reportId is required.");
  }

  const report = await repository.getReportById(reportId);
  if (!report) {
    return json(404, failure("NOT_FOUND", "Report not found."));
  }

  const payload = parseBody<{ status?: unknown; note?: unknown }>(event, ADMIN_REPORT_STATUS_SCHEMA);
  const status = parseReportStatus(String(payload.status || ""));
  if (!status) {
    throw new RequestError(400, "INVALID_REQUEST", "status is required.");
  }

  const note = normalizeOptionalText(payload.note, "note", 1000);

  const next = touchRecordMeta(
    {
      ...report,
      status,
      note: note || report.note,
      resolvedById: status === "resolved" || status === "dismissed"
        ? identitySub
        : report.resolvedById,
    },
    identitySub,
  );

  await repository.patchReport(next);
  auditLog({
    action: "admin.report.status_update",
    actorId: identitySub,
    actorRoles: ["admin"],
    resourceType: "report",
    resourceId: next.id,
    outcome: "success",
    metadata: {
      previousStatus: report.status,
      nextStatus: next.status,
      note: note || null,
    },
  });

  return json(200, success(mapReport(next)));
}

async function handleGetPlatformUsers(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const users = await repository.listUsers();
  const sorted = [...users].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items.map((user) => mapUser(user)),
      summary: {
        total: users.length,
        deleted: users.filter((user) => user.deleted).length,
        active: users.filter((user) => !user.deleted).length,
      },
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

async function handlePatchPlatformUser(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const userId = parseUserId(event);
  if (!userId) {
    throw new RequestError(400, "INVALID_REQUEST", "userId is required.");
  }

  const user = await repository.getUserById(userId);
  if (!user) {
    return json(404, failure("NOT_FOUND", "User not found."));
  }

  const payload = parseBody<{ deleted?: unknown; note?: unknown }>(event, ADMIN_USER_PATCH_SCHEMA);
  const deleted = parseBoolean(payload.deleted, "deleted");
  const note = normalizeOptionalText(payload.note, "note", 500);

  const next = touchRecordMeta({ ...user, deleted }, identitySub);
  await repository.patchUser(next);

  auditLog({
    action: deleted ? "admin.user.delete" : "admin.user.restore",
    actorId: identitySub,
    actorRoles: ["admin"],
    resourceType: "user",
    resourceId: next.id,
    outcome: "success",
    metadata: {
      note: note || null,
      previousDeleted: user.deleted,
      nextDeleted: next.deleted,
    },
  });

  return json(200, success(mapUser(next)));
}

async function handlePatchPlatformCategory(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const categoryId = parseCategoryId(event);
  if (!categoryId) {
    throw new RequestError(400, "INVALID_REQUEST", "categoryId is required.");
  }

  const category = await repository.getCategoryById(categoryId);
  if (!category) {
    return json(404, failure("NOT_FOUND", "Category not found."));
  }

  const payload = parseBody<{ name?: unknown; active?: unknown }>(event, ADMIN_CATEGORY_PATCH_SCHEMA);
  const hasName = payload.name != null;
  const hasActive = payload.active != null;

  if (!hasName && !hasActive) {
    throw new RequestError(400, "INVALID_REQUEST", "At least one field must be provided.");
  }

  const name = hasName ? normalizeRequiredText(payload.name, "name", 80) : category.name;
  const active = hasActive ? parseBoolean(payload.active, "active") : category.active;

  const next = touchRecordMeta(
    {
      ...category,
      name,
      sortName: categorySortName(name),
      active,
      activeStatus: categoryActiveStatus(active),
    },
    identitySub,
  );

  await repository.patchCategory(next);
  auditLog({
    action: "admin.category.patch",
    actorId: identitySub,
    actorRoles: ["admin"],
    resourceType: "category",
    resourceId: next.id,
    outcome: "success",
    metadata: {
      previousName: category.name,
      nextName: next.name,
      previousActive: category.active,
      nextActive: next.active,
    },
  });

  return json(200, success(mapCategory(next)));
}

async function handleGetSystem(
  repository: AdminWorkspaceRepository,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const [system, users, artists, reports, categories] = await Promise.all([
    resolveSystemConfig(repository, identitySub),
    repository.listUsers(),
    repository.listArtists(),
    repository.listReports(),
    repository.listCategories(),
  ]);

  return json(
    200,
    success({
      maintenanceMode: system.maintenanceMode,
      updatedAt: system.updatedAt,
      metrics: {
        users: users.length,
        artists: artists.length,
        reportsOpen: reports.filter((item) => item.status === "open" || item.status === "reviewing").length,
        categories: categories.length,
        errorCount: system.errorLog.length,
      },
    }),
  );
}

async function handlePatchSystemMaintenance(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const payload = parseBody<{ maintenanceMode?: unknown; note?: unknown }>(
    event,
    ADMIN_MAINTENANCE_PATCH_SCHEMA,
  );
  const maintenanceMode = parseBoolean(payload.maintenanceMode, "maintenanceMode");
  const note = normalizeOptionalText(payload.note, "note", 500);

  const existing = await resolveSystemConfig(repository, identitySub);

  const errorLog = [...existing.errorLog];
  if (note) {
    errorLog.unshift({
      id: `sys_note_${Date.now()}`,
      level: "info",
      message: `Maintenance ${maintenanceMode ? "enabled" : "disabled"}: ${note}`,
      createdAt: new Date().toISOString(),
      resolved: true,
    });
  }

  const next = touchRecordMeta(
    {
      ...existing,
      maintenanceMode,
      errorLog,
    },
    identitySub,
  );

  await repository.patchSystemConfig(next);
  auditLog({
    action: "admin.system.maintenance.patch",
    actorId: identitySub,
    actorRoles: ["admin"],
    resourceType: "system_config",
    resourceId: next.id,
    outcome: "success",
    metadata: {
      previousMaintenanceMode: existing.maintenanceMode,
      nextMaintenanceMode: next.maintenanceMode,
      note: note || null,
    },
  });

  return json(
    200,
    success({
      maintenanceMode: next.maintenanceMode,
      updatedAt: next.updatedAt,
      note: note || null,
    }),
  );
}

async function handleGetSystemErrors(
  event: APIGatewayProxyEventV2,
  repository: AdminWorkspaceRepository,
  identitySub: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const page = parsePage(event.queryStringParameters);
  const includeResolved = event.queryStringParameters?.includeResolved == null
    ? true
    : parseBoolean(event.queryStringParameters?.includeResolved, "includeResolved");

  const system = await resolveSystemConfig(repository, identitySub);

  const filtered = includeResolved
    ? system.errorLog
    : system.errorLog.filter((item) => !item.resolved);

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const paged = pageItems(sorted, page);

  return json(
    200,
    success({
      items: paged.items,
      summary: {
        total: system.errorLog.length,
        unresolved: system.errorLog.filter((item) => !item.resolved).length,
      },
      pagination: {
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: paged.nextCursor,
        count: paged.items.length,
      },
    }),
  );
}

export function createAdminApiHandler(
  repository: AdminWorkspaceRepository,
  roleAssignmentsRepository: RoleAssignmentsRepository = new NoopRoleAssignmentsRepository(),
) {
  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    try {
      enforceRequestSecurity(event, { requireBearerForMutations: true });
      const identity = await requireAuthIdentity(event, roleAssignmentsRepository);
      requireAdmin(identity);

      const method = String(event.requestContext.http.method || "").toUpperCase();
      const path = String(event.rawPath || "");

      if (method === "GET" && path === "/v1/admin/artists/review") {
        return await handleGetArtistsReview(event, repository);
      }

      if (method === "POST" && /^\/v1\/admin\/artists\/[^/]+\/verify$/.test(path)) {
        return await handleVerifyOrRejectArtist(event, repository, identity.sub, "verify");
      }

      if (method === "POST" && /^\/v1\/admin\/artists\/[^/]+\/reject$/.test(path)) {
        return await handleVerifyOrRejectArtist(event, repository, identity.sub, "reject");
      }

      if (method === "GET" && path === "/v1/admin/reports") {
        return await handleGetReports(event, repository);
      }

      if (method === "POST" && /^\/v1\/admin\/reports\/[^/]+\/status$/.test(path)) {
        return await handleUpdateReportStatus(event, repository, identity.sub);
      }

      if (method === "GET" && path === "/v1/admin/platform/users") {
        return await handleGetPlatformUsers(event, repository);
      }

      if (method === "PATCH" && /^\/v1\/admin\/platform\/users\/[^/]+$/.test(path)) {
        return await handlePatchPlatformUser(event, repository, identity.sub);
      }

      if (method === "PATCH" && /^\/v1\/admin\/platform\/categories\/[^/]+$/.test(path)) {
        return await handlePatchPlatformCategory(event, repository, identity.sub);
      }

      if (method === "GET" && path === "/v1/admin/system") {
        return await handleGetSystem(repository, identity.sub);
      }

      if (method === "PATCH" && path === "/v1/admin/system/maintenance") {
        return await handlePatchSystemMaintenance(event, repository, identity.sub);
      }

      if (method === "GET" && path === "/v1/admin/system/errors") {
        return await handleGetSystemErrors(event, repository, identity.sub);
      }

      return json(404, failure("NOT_FOUND", "Route not found."));
    } catch (error) {
      if (error instanceof RequestError) {
        return json(error.statusCode, failure(error.code, error.message));
      }

      if (error instanceof SecurityPolicyError) {
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

let runtimeHandler: ReturnType<typeof createAdminApiHandler> | null = null;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  runtimeHandler ||= createAdminApiHandler(getAdminWorkspaceRepository(), getRoleAssignmentsRepository());
  return await runtimeHandler(event);
};
