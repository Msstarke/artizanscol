import type {
  ArtistRecord,
  BookingRecord,
  CategoryRecord,
  InvoiceRecord,
  MessageRecord,
  NotificationRecord,
  PayoutRecord,
  ReportRecord,
  RoleAssignmentRecord,
  ServiceRecord,
  SystemConfigRecord,
  UserRecord,
} from "../domain/entities.js";
import type { BookingStatus } from "../domain/booking.js";
import type { ReportStatus, ReportType } from "../domain/entities.js";

export type PageRequest = {
  limit?: number;
  cursor?: string | null;
};

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export interface UsersRepository {
  getById(id: string): Promise<UserRecord | null>;
  getByCognitoSub(cognitoSub: string): Promise<UserRecord | null>;
  put(record: UserRecord): Promise<void>;
  patch(record: UserRecord): Promise<void>;
}

export interface ArtistsRepository {
  getById(id: string): Promise<ArtistRecord | null>;
  put(record: ArtistRecord): Promise<void>;
  patch(record: ArtistRecord): Promise<void>;
  listByCategoryPopularity(category: string, page?: PageRequest): Promise<PageResult<ArtistRecord>>;
  listByLocationRating(location: string, page?: PageRequest): Promise<PageResult<ArtistRecord>>;
}

export interface ServicesRepository {
  getById(id: string): Promise<ServiceRecord | null>;
  put(record: ServiceRecord): Promise<void>;
  patch(record: ServiceRecord): Promise<void>;
  delete(id: string): Promise<void>;
  listByArtistUpdatedAt(artistId: string, page?: PageRequest): Promise<PageResult<ServiceRecord>>;
}

export interface BookingsRepository {
  getById(id: string): Promise<BookingRecord | null>;
  put(record: BookingRecord): Promise<void>;
  patch(record: BookingRecord): Promise<void>;
  listByUserCreatedAt(userId: string, page?: PageRequest): Promise<PageResult<BookingRecord>>;
  listByArtistCreatedAt(artistId: string, page?: PageRequest): Promise<PageResult<BookingRecord>>;
  listByStatusUpdatedAt(status: BookingStatus, page?: PageRequest): Promise<PageResult<BookingRecord>>;
}

export interface MessagesRepository {
  getById(id: string): Promise<MessageRecord | null>;
  put(record: MessageRecord): Promise<void>;
  patch(record: MessageRecord): Promise<void>;
  listByThreadCreatedAt(threadId: string, page?: PageRequest): Promise<PageResult<MessageRecord>>;
}

export interface NotificationsRepository {
  getById(id: string): Promise<NotificationRecord | null>;
  put(record: NotificationRecord): Promise<void>;
  patch(record: NotificationRecord): Promise<void>;
  listByOwnerRead(ownerReadKey: string, page?: PageRequest): Promise<PageResult<NotificationRecord>>;
}

export interface ReportsRepository {
  getById(id: string): Promise<ReportRecord | null>;
  put(record: ReportRecord): Promise<void>;
  patch(record: ReportRecord): Promise<void>;
  listByStatusType(
    status: ReportStatus,
    type: ReportType,
    page?: PageRequest,
  ): Promise<PageResult<ReportRecord>>;
}

export interface CategoriesRepository {
  getById(id: string): Promise<CategoryRecord | null>;
  put(record: CategoryRecord): Promise<void>;
  patch(record: CategoryRecord): Promise<void>;
  listByActive(activeStatus: CategoryRecord["activeStatus"], page?: PageRequest): Promise<PageResult<CategoryRecord>>;
}

export interface InvoicesRepository {
  getById(id: string): Promise<InvoiceRecord | null>;
  put(record: InvoiceRecord): Promise<void>;
  patch(record: InvoiceRecord): Promise<void>;
  listByBooking(bookingId: string, page?: PageRequest): Promise<PageResult<InvoiceRecord>>;
}

export interface PayoutsRepository {
  getById(id: string): Promise<PayoutRecord | null>;
  put(record: PayoutRecord): Promise<void>;
  patch(record: PayoutRecord): Promise<void>;
  listByArtistDate(artistId: string, page?: PageRequest): Promise<PageResult<PayoutRecord>>;
}

export interface SystemConfigRepository {
  getById(id: string): Promise<SystemConfigRecord | null>;
  put(record: SystemConfigRecord): Promise<void>;
  patch(record: SystemConfigRecord): Promise<void>;
}

export interface RoleAssignmentsRepositoryV2 {
  getById(id: string): Promise<RoleAssignmentRecord | null>;
  put(record: RoleAssignmentRecord): Promise<void>;
  patch(record: RoleAssignmentRecord): Promise<void>;
  listBySubject(subjectId: string, page?: PageRequest): Promise<PageResult<RoleAssignmentRecord>>;
}
