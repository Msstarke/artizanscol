import type {
  ArtistRecord,
  BookingRecord,
  NotificationOwnerRole,
  NotificationRecord,
  ReviewRecord,
  ServiceRecord,
  UserRecord,
} from "../domain/entities.js";

export interface UserWorkspaceRepository {
  getUserByCognitoSub(cognitoSub: string): Promise<UserRecord | null>;
  patchUser(user: UserRecord): Promise<void>;

  getArtistById(artistId: string): Promise<ArtistRecord | null>;
  getServiceById(serviceId: string): Promise<ServiceRecord | null>;
  listArtistsByIds(artistIds: string[]): Promise<ArtistRecord[]>;

  saveArtistForUser(userId: string, artistId: string): Promise<UserRecord>;
  removeSavedArtistForUser(userId: string, artistId: string): Promise<UserRecord>;

  listBookingsByUserId(userId: string): Promise<BookingRecord[]>;
  getBookingById(bookingId: string): Promise<BookingRecord | null>;
  createBooking(booking: BookingRecord): Promise<void>;
  updateBooking(booking: BookingRecord): Promise<void>;

  listNotificationsByOwner(
    ownerRole: NotificationOwnerRole,
    ownerId: string,
  ): Promise<NotificationRecord[]>;
  createNotification(notification: NotificationRecord): Promise<void>;
  markNotificationsRead(ownerRole: NotificationOwnerRole, ownerId: string): Promise<number>;

  createReview(review: ReviewRecord): Promise<void>;
  listReviewsByArtistId(artistId: string): Promise<ReviewRecord[]>;
  getReviewByBookingId(bookingId: string): Promise<ReviewRecord | null>;
}

export class NoopUserWorkspaceRepository implements UserWorkspaceRepository {
  async getUserByCognitoSub(_cognitoSub: string): Promise<UserRecord | null> {
    return null;
  }

  async patchUser(_user: UserRecord): Promise<void> {}

  async getArtistById(_artistId: string): Promise<ArtistRecord | null> {
    return null;
  }

  async getServiceById(_serviceId: string): Promise<ServiceRecord | null> {
    return null;
  }

  async listArtistsByIds(_artistIds: string[]): Promise<ArtistRecord[]> {
    return [];
  }

  async saveArtistForUser(_userId: string, _artistId: string): Promise<UserRecord> {
    throw new Error("Not implemented");
  }

  async removeSavedArtistForUser(_userId: string, _artistId: string): Promise<UserRecord> {
    throw new Error("Not implemented");
  }

  async listBookingsByUserId(_userId: string): Promise<BookingRecord[]> {
    return [];
  }

  async getBookingById(_bookingId: string): Promise<BookingRecord | null> {
    return null;
  }

  async createBooking(_booking: BookingRecord): Promise<void> {}

  async updateBooking(_booking: BookingRecord): Promise<void> {}

  async listNotificationsByOwner(
    _ownerRole: NotificationOwnerRole,
    _ownerId: string,
  ): Promise<NotificationRecord[]> {
    return [];
  }

  async createNotification(_notification: NotificationRecord): Promise<void> {}

  async markNotificationsRead(
    _ownerRole: NotificationOwnerRole,
    _ownerId: string,
  ): Promise<number> {
    return 0;
  }

  async createReview(_review: ReviewRecord): Promise<void> {}

  async listReviewsByArtistId(_artistId: string): Promise<ReviewRecord[]> {
    return [];
  }

  async getReviewByBookingId(_bookingId: string): Promise<ReviewRecord | null> {
    return null;
  }
}
