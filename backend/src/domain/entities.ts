import type { AppRole } from "./auth.js";
import type { BookingStatus } from "./booking.js";
import type { PersistedRecord } from "./record-meta.js";

export type AvailabilityStatus = "open" | "limited" | "unavailable";

export type PortfolioItem = {
  id: string;
  title: string;
  medium: string;
  imageUrl?: string;
  createdAt: string;
};

export type UserRecord = PersistedRecord & {
  cognitoSub: string;
  cognitoEmail: string;
  name: string;
  email: string;
  location: string;
  bio: string;
  emailVerified: boolean;
  profileCompleted: boolean;
  preferences: {
    bookingUpdates: boolean;
    messageAlerts: boolean;
    marketingEmails: boolean;
    browserNotifications: boolean;
  };
  setup: {
    status: "not_started" | "in_progress" | "completed";
    currentStep: "welcome" | "profile" | "preferences" | "artist_prompt" | "artist_profile" | "review" | "done";
    artistOptIn: boolean;
    completedAt: string | null;
  };
  savedArtistIds: string[];
  bookingHistoryIds: string[];
  deleted: boolean;
};

export type ArtistRecord = PersistedRecord & {
  cognitoSub: string;
  cognitoEmail: string;
  name: string;
  handle: string;
  category: string;
  mediums: string[];
  location: string;
  verified: boolean;
  popularity: number;
  rating: number;
  reviewCount: number;
  priceFrom: number;
  availability: AvailabilityStatus;
  bio: string;
  profileVisible: boolean;
  profileViews: number;
  completedBookings: number;
  acceptanceRate: number;
  portfolio: PortfolioItem[];
};

export type ServiceRecord = PersistedRecord & {
  artistId: string;
  title: string;
  description: string;
  price: number;
  deliveryDays: number;
};

export type BookingRecord = PersistedRecord & {
  userId: string;
  artistId: string;
  serviceId: string | null;
  serviceLabel?: string;
  budget: number;
  deadline: string;
  message: string;
  status: BookingStatus;
  threadId: string;
  history: Array<{
    at: string;
    by: string;
    from: BookingStatus;
    to: BookingStatus;
    note?: string;
  }>;
};

export type MessageRecord = PersistedRecord & {
  threadId: string;
  bookingId?: string;
  fromId: string;
  toId: string;
  body: string;
  read: boolean;
};

export type NotificationOwnerRole = "user" | "artist" | "admin";

export type NotificationRecord = PersistedRecord & {
  ownerId: string;
  ownerRole: NotificationOwnerRole;
  ownerReadKey: string;
  type: string;
  title: string;
  detail: string;
  read: boolean;
};

export type ReportType = "spam" | "abuse" | "copyright" | "ai";
export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export type ReportRecord = PersistedRecord & {
  type: ReportType;
  status: ReportStatus;
  targetId: string;
  reportedById: string;
  note: string;
  resolvedById?: string;
  metadata?: Record<string, unknown>;
};

export type CategoryRecord = PersistedRecord & {
  name: string;
  sortName: string;
  active: boolean;
  activeStatus: "active" | "inactive";
};

export type InvoiceStatus = "draft" | "paid" | "void";

export type InvoiceRecord = PersistedRecord & {
  bookingId: string;
  userId: string;
  artistId: string;
  amount: number;
  status: InvoiceStatus;
};

export type PayoutStatus = "scheduled" | "processing" | "paid" | "failed";

export type PayoutRecord = PersistedRecord & {
  artistId: string;
  amount: number;
  status: PayoutStatus;
  date: string;
};

export type SystemErrorLogItem = {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
  resolved: boolean;
};

export type ModerationConfig = {
  customBlockWords: string[];
  customFlagWords: string[];
};

export type SystemConfigRecord = PersistedRecord & {
  maintenanceMode: boolean;
  errorLog: SystemErrorLogItem[];
  moderationConfig?: ModerationConfig;
};

export type RoleAssignmentRecord = PersistedRecord & {
  subjectId: string;
  role: AppRole;
};
