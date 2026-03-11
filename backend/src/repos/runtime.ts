import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  QueryCommandInput,
  ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type {
  AdminWorkspaceRepository,
} from "./admin-workspace.js";
import type {
  ArtistWorkspaceRepository,
} from "./artist-workspace.js";
import type {
  ArtistRecord,
  BookingRecord,
  CategoryRecord,
  InvoiceRecord,
  MessageRecord,
  NotificationOwnerRole,
  NotificationRecord,
  PayoutRecord,
  ReportRecord,
  RoleAssignmentRecord,
  ServiceRecord,
  SystemConfigRecord,
  UserRecord,
} from "../domain/entities.js";
import { ownerReadKey } from "../domain/index-keys.js";
import { loadEnv, type AppEnv } from "../lib/env.js";
import type {
  CheckoutSessionSnapshot,
  PaymentsWorkspaceRepository,
  ProcessedWebhookEvent,
  RefundSnapshot,
} from "./payments-workspace.js";
import type { PublicDiscoveryRepository } from "./public-discovery.js";
import type { RoleAssignmentsRepository } from "./role-assignments.js";
import { INDEXES } from "./table-contracts.js";
import type { MessagingWorkspaceRepository } from "./messaging-workspace.js";
import type { UserWorkspaceRepository } from "./user-workspace.js";

const SYSTEM_CONFIG_ID = "system";
const DEFAULT_USER_PREFERENCES: UserRecord["preferences"] = {
  bookingUpdates: true,
  messageAlerts: true,
  marketingEmails: false,
  browserNotifications: false,
};
const DEFAULT_USER_SETUP: UserRecord["setup"] = {
  status: "not_started",
  currentStep: "welcome",
  artistOptIn: false,
  completedAt: null,
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUserRecord(user: UserRecord): UserRecord {
  const savedArtistIds = asArray<string>(user.savedArtistIds).length
    ? asArray<string>(user.savedArtistIds)
    : asArray<string>((user as unknown as { savedArtists?: string[] }).savedArtists);
  const bookingHistoryIds = asArray<string>(user.bookingHistoryIds).length
    ? asArray<string>(user.bookingHistoryIds)
    : asArray<string>((user as unknown as { bookingHistory?: string[] }).bookingHistory);

  const setup: UserRecord["setup"] = user.setup
    ? {
        status: user.setup.status || DEFAULT_USER_SETUP.status,
        currentStep: user.setup.currentStep || DEFAULT_USER_SETUP.currentStep,
        artistOptIn: user.setup.artistOptIn ?? DEFAULT_USER_SETUP.artistOptIn,
        completedAt: user.setup.completedAt ?? DEFAULT_USER_SETUP.completedAt,
      }
    : user.profileCompleted
      ? {
          status: "completed",
          currentStep: "done",
          artistOptIn: false,
          completedAt: user.updatedAt || user.createdAt || null,
        }
      : { ...DEFAULT_USER_SETUP };

  return {
    ...user,
    cognitoEmail: String(user.cognitoEmail || user.email || ""),
    name: String(user.name || "Member"),
    email: String(user.email || user.cognitoEmail || ""),
    location: String(user.location || ""),
    bio: String(user.bio || ""),
    emailVerified: Boolean(user.emailVerified),
    profileCompleted: Boolean(user.profileCompleted),
    preferences: {
      bookingUpdates: user.preferences?.bookingUpdates ?? DEFAULT_USER_PREFERENCES.bookingUpdates,
      messageAlerts: user.preferences?.messageAlerts ?? DEFAULT_USER_PREFERENCES.messageAlerts,
      marketingEmails: user.preferences?.marketingEmails ?? DEFAULT_USER_PREFERENCES.marketingEmails,
      browserNotifications: user.preferences?.browserNotifications ?? DEFAULT_USER_PREFERENCES.browserNotifications,
    },
    setup,
    savedArtistIds: Array.from(new Set(savedArtistIds.filter(Boolean))),
    bookingHistoryIds: Array.from(new Set(bookingHistoryIds.filter(Boolean))),
    deleted: Boolean(user.deleted),
  };
}

function normalizeArtistRecord(artist: ArtistRecord): ArtistRecord {
  return {
    ...artist,
    cognitoEmail: String(artist.cognitoEmail || ""),
    name: String(artist.name || "Artist"),
    handle: String(artist.handle || "artist"),
    category: String(artist.category || ""),
    mediums: Array.from(new Set(asArray<string>(artist.mediums).filter(Boolean))),
    location: String(artist.location || ""),
    verified: Boolean(artist.verified),
    popularity: Number(artist.popularity || 0),
    rating: Number(artist.rating || 0),
    reviewCount: Number(artist.reviewCount || 0),
    priceFrom: Number(artist.priceFrom || 0),
    availability: (artist.availability || "open") as ArtistRecord["availability"],
    bio: String(artist.bio || ""),
    profileVisible: Boolean(artist.profileVisible),
    profileViews: Number(artist.profileViews || 0),
    completedBookings: Number(artist.completedBookings || 0),
    acceptanceRate: Number(artist.acceptanceRate || 0),
    portfolio: asArray<ArtistRecord["portfolio"][number]>(artist.portfolio).map((item) => ({
      id: String(item?.id || ""),
      title: String(item?.title || "Untitled"),
      medium: String(item?.medium || "Digital"),
      imageUrl: String(item?.imageUrl || "") || undefined,
      createdAt: String(item?.createdAt || artist.createdAt || nowIso()),
    })),
  };
}

function normalizeCategoryRecord(category: CategoryRecord): CategoryRecord {
  return {
    ...category,
    name: String(category.name || ""),
    sortName: String(category.sortName || String(category.name || "").trim().toLowerCase()),
    active: Boolean(category.active),
    activeStatus: category.active ? "active" : "inactive",
  };
}

function normalizeNotificationRecord(notification: NotificationRecord): NotificationRecord {
  return {
    ...notification,
    ownerReadKey: notification.ownerReadKey || ownerReadKey(notification.ownerId, Boolean(notification.read)),
    read: Boolean(notification.read),
    type: String(notification.type || "system"),
    title: String(notification.title || "Update"),
    detail: String(notification.detail || ""),
  };
}

function normalizeMessageRecord(message: MessageRecord): MessageRecord {
  return {
    ...message,
    bookingId: message.bookingId || undefined,
    body: String(message.body || ""),
    read: Boolean(message.read),
  };
}

function normalizeBookingRecord(booking: BookingRecord): BookingRecord {
  return {
    ...booking,
    serviceId: booking.serviceId || null,
    serviceLabel: String((booking as BookingRecord & { serviceLabel?: string }).serviceLabel || ""),
    budget: Number(booking.budget || 0),
    deadline: String(booking.deadline || ""),
    message: String(booking.message || ""),
    history: asArray<BookingRecord["history"][number]>(booking.history).map((entry) => ({
      at: String(entry.at || nowIso()),
      by: String(entry.by || booking.createdBy || "system"),
      from: entry.from,
      to: entry.to,
      note: entry.note ? String(entry.note) : undefined,
    })),
  };
}

function normalizeSystemConfigRecord(config: SystemConfigRecord): SystemConfigRecord {
  return {
    ...config,
    maintenanceMode: Boolean(config.maintenanceMode),
    errorLog: asArray<SystemConfigRecord["errorLog"][number]>(config.errorLog).map((item) => ({
      id: String(item.id || `sys_${Date.now()}`),
      level: item.level || "info",
      message: String(item.message || ""),
      createdAt: String(item.createdAt || nowIso()),
      resolved: Boolean(item.resolved),
    })),
  };
}

class RuntimeRepository
  implements
    PublicDiscoveryRepository,
    UserWorkspaceRepository,
    ArtistWorkspaceRepository,
    MessagingWorkspaceRepository,
    AdminWorkspaceRepository,
    PaymentsWorkspaceRepository,
    RoleAssignmentsRepository
{
  private readonly env: AppEnv;
  private readonly ddb: DynamoDBDocumentClient;
  private readonly secrets: SecretsManagerClient;
  private webhookSecretCache: string | null = null;

  constructor(env: AppEnv = loadEnv()) {
    this.env = env;
    const dynamo = new DynamoDBClient({ region: env.awsRegion });
    this.ddb = DynamoDBDocumentClient.from(dynamo, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
    this.secrets = new SecretsManagerClient({ region: env.awsRegion });
  }

  private async getById<T>(tableName: string, id: string): Promise<T | null> {
    const response = await this.ddb.send(new GetCommand({ TableName: tableName, Key: { id } }));
    return (response.Item as T | undefined) || null;
  }

  private async putItem(tableName: string, item: Record<string, unknown>): Promise<void> {
    await this.ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  }

  private async deleteById(tableName: string, id: string): Promise<void> {
    await this.ddb.send(new DeleteCommand({ TableName: tableName, Key: { id } }));
  }

  private async queryAll<T>(input: QueryCommandInput): Promise<T[]> {
    const items: T[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.ddb.send(
        new QueryCommand({
          ...input,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...asArray<T>(response.Items));
      exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }

  private async scanAll<T>(input: ScanCommandInput): Promise<T[]> {
    const items: T[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.ddb.send(
        new ScanCommand({
          ...input,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...asArray<T>(response.Items));
      exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }

  private async scanArtistsByCognitoSub(cognitoSub: string): Promise<ArtistRecord | null> {
    const items = await this.scanAll<ArtistRecord>({
      TableName: this.env.artistsTableName,
      FilterExpression: "cognitoSub = :cognitoSub",
      ExpressionAttributeValues: {
        ":cognitoSub": cognitoSub,
      },
      Limit: 1,
    });

    const artist = items[0] || null;
    return artist ? normalizeArtistRecord(artist) : null;
  }

  private async scanMessagesByParticipant(participantId: string): Promise<MessageRecord[]> {
    const items = await this.scanAll<MessageRecord>({
      TableName: this.env.messagesTableName,
      FilterExpression: "fromId = :participantId OR toId = :participantId",
      ExpressionAttributeValues: {
        ":participantId": participantId,
      },
    });

    return items.map(normalizeMessageRecord);
  }

  private async getUserByIdInternal(userId: string): Promise<UserRecord | null> {
    const record = await this.getById<UserRecord>(this.env.usersTableName, userId);
    return record ? normalizeUserRecord(record) : null;
  }

  private async getNotificationsByOwnerId(ownerId: string): Promise<NotificationRecord[]> {
    const [unread, read] = await Promise.all([
      this.queryAll<NotificationRecord>({
        TableName: this.env.notificationsTableName,
        IndexName: INDEXES.notificationsByOwnerRead,
        KeyConditionExpression: "ownerReadKey = :ownerReadKey",
        ExpressionAttributeValues: {
          ":ownerReadKey": ownerReadKey(ownerId, false),
        },
      }),
      this.queryAll<NotificationRecord>({
        TableName: this.env.notificationsTableName,
        IndexName: INDEXES.notificationsByOwnerRead,
        KeyConditionExpression: "ownerReadKey = :ownerReadKey",
        ExpressionAttributeValues: {
          ":ownerReadKey": ownerReadKey(ownerId, true),
        },
      }),
    ]);

    return [...unread, ...read].map(normalizeNotificationRecord);
  }

  private async getSystemSnapshot<T>(id: string): Promise<T | null> {
    return await this.getById<T>(this.env.systemConfigTableName, id);
  }

  private async putSystemSnapshot(id: string, payload: Record<string, unknown>): Promise<void> {
    await this.putItem(this.env.systemConfigTableName, {
      id,
      ...payload,
    });
  }

  async listCategories(): Promise<CategoryRecord[]> {
    const items = await this.scanAll<CategoryRecord>({ TableName: this.env.categoriesTableName });
    return items.map(normalizeCategoryRecord);
  }

  async listArtists(): Promise<ArtistRecord[]> {
    const items = await this.scanAll<ArtistRecord>({ TableName: this.env.artistsTableName });
    return items.map(normalizeArtistRecord).filter((artist) => artist.profileVisible);
  }

  async listServicesByArtistId(artistId: string): Promise<ServiceRecord[]> {
    const items = await this.queryAll<ServiceRecord>({
      TableName: this.env.servicesTableName,
      IndexName: INDEXES.servicesByArtistUpdatedAt,
      KeyConditionExpression: "artistId = :artistId",
      ExpressionAttributeValues: {
        ":artistId": artistId,
      },
    });
    return items;
  }

  async getUserByCognitoSub(cognitoSub: string): Promise<UserRecord | null> {
    const items = await this.queryAll<UserRecord>({
      TableName: this.env.usersTableName,
      IndexName: INDEXES.usersByCognitoSub,
      KeyConditionExpression: "cognitoSub = :cognitoSub",
      ExpressionAttributeValues: {
        ":cognitoSub": cognitoSub,
      },
      Limit: 1,
    });

    const user = items[0] || null;
    return user ? normalizeUserRecord(user) : null;
  }

  async patchUser(user: UserRecord): Promise<void> {
    await this.putItem(this.env.usersTableName, normalizeUserRecord(user));
  }

  async getArtistById(artistId: string): Promise<ArtistRecord | null> {
    const record = await this.getById<ArtistRecord>(this.env.artistsTableName, artistId);
    return record ? normalizeArtistRecord(record) : null;
  }

  async getServiceById(serviceId: string): Promise<ServiceRecord | null> {
    const record = await this.getById<ServiceRecord>(this.env.servicesTableName, serviceId);
    return record || null;
  }

  async listArtistsByIds(artistIds: string[]): Promise<ArtistRecord[]> {
    const ids = Array.from(new Set(artistIds.filter(Boolean)));
    if (!ids.length) {
      return [];
    }

    const response = await this.ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [this.env.artistsTableName]: {
            Keys: ids.map((id) => ({ id })),
          },
        },
      }),
    );

    return asArray<ArtistRecord>(response.Responses?.[this.env.artistsTableName]).map(normalizeArtistRecord);
  }

  async saveArtistForUser(userId: string, artistId: string): Promise<UserRecord> {
    const user = await this.getUserByIdInternal(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const next = normalizeUserRecord({
      ...user,
      savedArtistIds: Array.from(new Set([artistId, ...user.savedArtistIds])),
      updatedAt: nowIso(),
      version: Number(user.version || 0) + 1,
    });

    await this.patchUser(next);
    return next;
  }

  async removeSavedArtistForUser(userId: string, artistId: string): Promise<UserRecord> {
    const user = await this.getUserByIdInternal(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const next = normalizeUserRecord({
      ...user,
      savedArtistIds: user.savedArtistIds.filter((id) => id !== artistId),
      updatedAt: nowIso(),
      version: Number(user.version || 0) + 1,
    });

    await this.patchUser(next);
    return next;
  }

  async listBookingsByUserId(userId: string): Promise<BookingRecord[]> {
    const items = await this.queryAll<BookingRecord>({
      TableName: this.env.bookingsTableName,
      IndexName: INDEXES.bookingsByUserCreatedAt,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
    });

    return items.map(normalizeBookingRecord);
  }

  async getBookingById(bookingId: string): Promise<BookingRecord | null> {
    const record = await this.getById<BookingRecord>(this.env.bookingsTableName, bookingId);
    return record ? normalizeBookingRecord(record) : null;
  }

  async createBooking(booking: BookingRecord): Promise<void> {
    await this.putItem(this.env.bookingsTableName, normalizeBookingRecord(booking));
  }

  async updateBooking(booking: BookingRecord): Promise<void> {
    await this.putItem(this.env.bookingsTableName, normalizeBookingRecord(booking));
  }

  async listNotificationsByOwner(
    _ownerRole: NotificationOwnerRole,
    ownerId: string,
  ): Promise<NotificationRecord[]> {
    return await this.getNotificationsByOwnerId(ownerId);
  }

  async createNotification(notification: NotificationRecord): Promise<void> {
    await this.putItem(this.env.notificationsTableName, normalizeNotificationRecord(notification));
  }

  async markNotificationsRead(
    _ownerRole: NotificationOwnerRole,
    ownerId: string,
  ): Promise<number> {
    const unread = await this.queryAll<NotificationRecord>({
      TableName: this.env.notificationsTableName,
      IndexName: INDEXES.notificationsByOwnerRead,
      KeyConditionExpression: "ownerReadKey = :ownerReadKey",
      ExpressionAttributeValues: {
        ":ownerReadKey": ownerReadKey(ownerId, false),
      },
    });

    let updatedCount = 0;
    for (const item of unread.map(normalizeNotificationRecord)) {
      const next = normalizeNotificationRecord({
        ...item,
        read: true,
        ownerReadKey: ownerReadKey(ownerId, true),
        updatedAt: nowIso(),
        version: Number(item.version || 0) + 1,
      });
      await this.putItem(this.env.notificationsTableName, next);
      updatedCount += 1;
    }

    return updatedCount;
  }

  async getArtistByCognitoSub(cognitoSub: string): Promise<ArtistRecord | null> {
    return await this.scanArtistsByCognitoSub(cognitoSub);
  }

  async patchArtist(artist: ArtistRecord): Promise<void> {
    await this.putItem(this.env.artistsTableName, normalizeArtistRecord(artist));
  }

  async createService(service: ServiceRecord): Promise<void> {
    await this.putItem(this.env.servicesTableName, service);
  }

  async updateService(service: ServiceRecord): Promise<void> {
    await this.putItem(this.env.servicesTableName, service);
  }

  async deleteService(serviceId: string): Promise<void> {
    await this.deleteById(this.env.servicesTableName, serviceId);
  }

  async listBookingsByArtistId(artistId: string): Promise<BookingRecord[]> {
    const items = await this.queryAll<BookingRecord>({
      TableName: this.env.bookingsTableName,
      IndexName: INDEXES.bookingsByArtistCreatedAt,
      KeyConditionExpression: "artistId = :artistId",
      ExpressionAttributeValues: {
        ":artistId": artistId,
      },
    });

    return items.map(normalizeBookingRecord);
  }

  async listMessagesByParticipantId(participantId: string): Promise<MessageRecord[]> {
    return await this.scanMessagesByParticipant(participantId);
  }

  async listMessagesByThreadId(threadId: string): Promise<MessageRecord[]> {
    const items = await this.queryAll<MessageRecord>({
      TableName: this.env.messagesTableName,
      IndexName: INDEXES.messagesByThreadCreatedAt,
      KeyConditionExpression: "threadId = :threadId",
      ExpressionAttributeValues: {
        ":threadId": threadId,
      },
    });

    return items.map(normalizeMessageRecord);
  }

  async createMessage(message: MessageRecord): Promise<void> {
    await this.putItem(this.env.messagesTableName, normalizeMessageRecord(message));
  }

  async listReports(): Promise<ReportRecord[]> {
    return await this.scanAll<ReportRecord>({ TableName: this.env.reportsTableName });
  }

  async getReportById(reportId: string): Promise<ReportRecord | null> {
    return await this.getById<ReportRecord>(this.env.reportsTableName, reportId);
  }

  async patchReport(report: ReportRecord): Promise<void> {
    await this.putItem(this.env.reportsTableName, report);
  }

  async listUsers(): Promise<UserRecord[]> {
    const items = await this.scanAll<UserRecord>({ TableName: this.env.usersTableName });
    return items.map(normalizeUserRecord);
  }

  async getCategoryById(categoryId: string): Promise<CategoryRecord | null> {
    const record = await this.getById<CategoryRecord>(this.env.categoriesTableName, categoryId);
    return record ? normalizeCategoryRecord(record) : null;
  }

  async patchCategory(category: CategoryRecord): Promise<void> {
    await this.putItem(this.env.categoriesTableName, normalizeCategoryRecord(category));
  }

  async getSystemConfig(): Promise<SystemConfigRecord | null> {
    const record = await this.getById<SystemConfigRecord>(this.env.systemConfigTableName, SYSTEM_CONFIG_ID);
    return record ? normalizeSystemConfigRecord(record) : null;
  }

  async putSystemConfig(config: SystemConfigRecord): Promise<void> {
    await this.putItem(this.env.systemConfigTableName, normalizeSystemConfigRecord(config));
  }

  async patchSystemConfig(config: SystemConfigRecord): Promise<void> {
    await this.putItem(this.env.systemConfigTableName, normalizeSystemConfigRecord(config));
  }

  async createInvoice(invoice: InvoiceRecord): Promise<void> {
    await this.putItem(this.env.invoicesTableName, invoice);
  }

  async listInvoicesByBookingId(bookingId: string): Promise<InvoiceRecord[]> {
    return await this.queryAll<InvoiceRecord>({
      TableName: this.env.invoicesTableName,
      IndexName: INDEXES.invoicesByBooking,
      KeyConditionExpression: "bookingId = :bookingId",
      ExpressionAttributeValues: {
        ":bookingId": bookingId,
      },
    });
  }

  async patchInvoice(invoice: InvoiceRecord): Promise<void> {
    await this.putItem(this.env.invoicesTableName, invoice);
  }

  async createPayout(payout: PayoutRecord): Promise<void> {
    await this.putItem(this.env.payoutsTableName, payout);
  }

  async getCheckoutSessionByIdempotencyKey(key: string): Promise<CheckoutSessionSnapshot | null> {
    return await this.getSystemSnapshot<CheckoutSessionSnapshot>(`checkout:${key}`);
  }

  async putCheckoutSessionByIdempotencyKey(snapshot: CheckoutSessionSnapshot): Promise<void> {
    await this.putSystemSnapshot(`checkout:${snapshot.idempotencyKey}`, snapshot as unknown as Record<string, unknown>);
  }

  async getRefundByIdempotencyKey(key: string): Promise<RefundSnapshot | null> {
    return await this.getSystemSnapshot<RefundSnapshot>(`refund:${key}`);
  }

  async putRefundByIdempotencyKey(snapshot: RefundSnapshot): Promise<void> {
    await this.putSystemSnapshot(`refund:${snapshot.idempotencyKey}`, snapshot as unknown as Record<string, unknown>);
  }

  async getProcessedWebhookEvent(eventId: string): Promise<ProcessedWebhookEvent | null> {
    return await this.getSystemSnapshot<ProcessedWebhookEvent>(`webhook:${eventId}`);
  }

  async putProcessedWebhookEvent(event: ProcessedWebhookEvent): Promise<void> {
    await this.putSystemSnapshot(`webhook:${event.eventId}`, event as unknown as Record<string, unknown>);
  }

  async getStripeWebhookSigningSecret(): Promise<string> {
    if (this.webhookSecretCache) {
      return this.webhookSecretCache;
    }

    const response = await this.secrets.send(
      new GetSecretValueCommand({ SecretId: this.env.stripeWebhookSecretArn }),
    );
    const secretString = String(response.SecretString || "");
    if (!secretString) {
      return "";
    }

    try {
      const parsed = JSON.parse(secretString) as Record<string, unknown>;
      const secret = String(parsed.webhookSecret || parsed.secret || parsed.placeholder || "").trim();
      this.webhookSecretCache = secret;
      return secret;
    } catch (_) {
      this.webhookSecretCache = secretString;
      return secretString;
    }
  }

  async listRolesForSubject(subjectId: string): Promise<RoleAssignmentRecord["role"][]> {
    const items = await this.queryAll<RoleAssignmentRecord>({
      TableName: this.env.roleAssignmentsTableName,
      IndexName: INDEXES.rolesBySubject,
      KeyConditionExpression: "subjectId = :subjectId",
      ExpressionAttributeValues: {
        ":subjectId": subjectId,
      },
    });

    return Array.from(new Set(items.map((item) => item.role).filter(Boolean)));
  }
}

let runtimeRepository: RuntimeRepository | null = null;

function getRuntimeRepository(): RuntimeRepository {
  if (!runtimeRepository) {
    runtimeRepository = new RuntimeRepository();
  }
  return runtimeRepository;
}

export function getPublicDiscoveryRepository(): PublicDiscoveryRepository {
  return getRuntimeRepository();
}

export function getUserWorkspaceRepository(): UserWorkspaceRepository {
  return getRuntimeRepository();
}

export function getArtistWorkspaceRepository(): ArtistWorkspaceRepository {
  return getRuntimeRepository();
}

export function getMessagingWorkspaceRepository(): MessagingWorkspaceRepository {
  return getRuntimeRepository();
}

export function getAdminWorkspaceRepository(): AdminWorkspaceRepository {
  return getRuntimeRepository();
}

export function getPaymentsWorkspaceRepository(): PaymentsWorkspaceRepository {
  return getRuntimeRepository();
}

export function getRoleAssignmentsRepository(): RoleAssignmentsRepository {
  return getRuntimeRepository();
}
