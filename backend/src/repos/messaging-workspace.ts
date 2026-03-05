import type {
  ArtistRecord,
  BookingRecord,
  MessageRecord,
  NotificationOwnerRole,
  NotificationRecord,
  UserRecord,
} from "../domain/entities.js";

export interface MessagingWorkspaceRepository {
  getUserByCognitoSub(cognitoSub: string): Promise<UserRecord | null>;
  getArtistByCognitoSub(cognitoSub: string): Promise<ArtistRecord | null>;

  listBookingsByUserId(userId: string): Promise<BookingRecord[]>;
  listBookingsByArtistId(artistId: string): Promise<BookingRecord[]>;

  listMessagesByParticipantId(participantId: string): Promise<MessageRecord[]>;
  listMessagesByThreadId(threadId: string): Promise<MessageRecord[]>;
  createMessage(message: MessageRecord): Promise<void>;

  listNotificationsByOwner(
    ownerRole: NotificationOwnerRole,
    ownerId: string,
  ): Promise<NotificationRecord[]>;
}

export class NoopMessagingWorkspaceRepository implements MessagingWorkspaceRepository {
  async getUserByCognitoSub(_cognitoSub: string): Promise<UserRecord | null> {
    return null;
  }

  async getArtistByCognitoSub(_cognitoSub: string): Promise<ArtistRecord | null> {
    return null;
  }

  async listBookingsByUserId(_userId: string): Promise<BookingRecord[]> {
    return [];
  }

  async listBookingsByArtistId(_artistId: string): Promise<BookingRecord[]> {
    return [];
  }

  async listMessagesByParticipantId(_participantId: string): Promise<MessageRecord[]> {
    return [];
  }

  async listMessagesByThreadId(_threadId: string): Promise<MessageRecord[]> {
    return [];
  }

  async createMessage(_message: MessageRecord): Promise<void> {}

  async listNotificationsByOwner(
    _ownerRole: NotificationOwnerRole,
    _ownerId: string,
  ): Promise<NotificationRecord[]> {
    return [];
  }
}
