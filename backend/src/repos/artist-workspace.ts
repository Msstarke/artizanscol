import type {
  ArtistRecord,
  BookingRecord,
  MessageRecord,
  NotificationOwnerRole,
  NotificationRecord,
  ServiceRecord,
} from "../domain/entities.js";

export interface ArtistWorkspaceRepository {
  getArtistByCognitoSub(cognitoSub: string): Promise<ArtistRecord | null>;
  patchArtist(artist: ArtistRecord): Promise<void>;
  isHandleTaken(handle: string, excludeArtistId: string): Promise<boolean>;

  listServicesByArtistId(artistId: string): Promise<ServiceRecord[]>;
  getServiceById(serviceId: string): Promise<ServiceRecord | null>;
  createService(service: ServiceRecord): Promise<void>;
  updateService(service: ServiceRecord): Promise<void>;
  deleteService(serviceId: string): Promise<void>;

  listBookingsByArtistId(artistId: string): Promise<BookingRecord[]>;
  getBookingById(bookingId: string): Promise<BookingRecord | null>;
  updateBooking(booking: BookingRecord): Promise<void>;

  listMessagesByParticipantId(participantId: string): Promise<MessageRecord[]>;

  listNotificationsByOwner(
    ownerRole: NotificationOwnerRole,
    ownerId: string,
  ): Promise<NotificationRecord[]>;
  createNotification(notification: NotificationRecord): Promise<void>;
  markNotificationsRead(ownerRole: NotificationOwnerRole, ownerId: string): Promise<number>;
}

export class NoopArtistWorkspaceRepository implements ArtistWorkspaceRepository {
  async getArtistByCognitoSub(_cognitoSub: string): Promise<ArtistRecord | null> {
    return null;
  }

  async patchArtist(_artist: ArtistRecord): Promise<void> {}

  async isHandleTaken(_handle: string, _excludeArtistId: string): Promise<boolean> {
    return false;
  }

  async listServicesByArtistId(_artistId: string): Promise<ServiceRecord[]> {
    return [];
  }

  async getServiceById(_serviceId: string): Promise<ServiceRecord | null> {
    return null;
  }

  async createService(_service: ServiceRecord): Promise<void> {}

  async updateService(_service: ServiceRecord): Promise<void> {}

  async deleteService(_serviceId: string): Promise<void> {}

  async listBookingsByArtistId(_artistId: string): Promise<BookingRecord[]> {
    return [];
  }

  async getBookingById(_bookingId: string): Promise<BookingRecord | null> {
    return null;
  }

  async updateBooking(_booking: BookingRecord): Promise<void> {}

  async listMessagesByParticipantId(_participantId: string): Promise<MessageRecord[]> {
    return [];
  }

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
}
