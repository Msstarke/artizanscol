import type {
  BookingRecord,
  InvoiceRecord,
  NotificationRecord,
  PayoutRecord,
  UserRecord,
} from "../domain/entities.js";

export type CheckoutSessionSnapshot = {
  idempotencyKey: string;
  bookingId: string;
  sessionId: string;
  paymentIntentId: string;
  checkoutUrl: string;
  amount: number;
  currency: string;
  createdAt: string;
};

export type RefundSnapshot = {
  idempotencyKey: string;
  bookingId: string;
  refundId: string;
  status: "requested" | "accepted" | "rejected";
  reason: string;
  createdAt: string;
};

export type ProcessedWebhookEvent = {
  eventId: string;
  type: string;
  processedAt: string;
  outcome: "processed" | "ignored" | "duplicate" | "failed";
};

export interface PaymentsWorkspaceRepository {
  getUserByCognitoSub(cognitoSub: string): Promise<UserRecord | null>;

  getBookingById(bookingId: string): Promise<BookingRecord | null>;
  updateBooking(booking: BookingRecord): Promise<void>;

  createInvoice(invoice: InvoiceRecord): Promise<void>;
  listInvoicesByBookingId(bookingId: string): Promise<InvoiceRecord[]>;
  patchInvoice(invoice: InvoiceRecord): Promise<void>;

  createPayout(payout: PayoutRecord): Promise<void>;

  createNotification(notification: NotificationRecord): Promise<void>;

  getCheckoutSessionByIdempotencyKey(key: string): Promise<CheckoutSessionSnapshot | null>;
  putCheckoutSessionByIdempotencyKey(snapshot: CheckoutSessionSnapshot): Promise<void>;

  getRefundByIdempotencyKey(key: string): Promise<RefundSnapshot | null>;
  putRefundByIdempotencyKey(snapshot: RefundSnapshot): Promise<void>;

  getProcessedWebhookEvent(eventId: string): Promise<ProcessedWebhookEvent | null>;
  putProcessedWebhookEvent(event: ProcessedWebhookEvent): Promise<void>;

  getStripeWebhookSigningSecret(): Promise<string>;
}

export class NoopPaymentsWorkspaceRepository implements PaymentsWorkspaceRepository {
  async getUserByCognitoSub(_cognitoSub: string): Promise<UserRecord | null> {
    return null;
  }

  async getBookingById(_bookingId: string): Promise<BookingRecord | null> {
    return null;
  }

  async updateBooking(_booking: BookingRecord): Promise<void> {}

  async createInvoice(_invoice: InvoiceRecord): Promise<void> {}

  async listInvoicesByBookingId(_bookingId: string): Promise<InvoiceRecord[]> {
    return [];
  }

  async patchInvoice(_invoice: InvoiceRecord): Promise<void> {}

  async createPayout(_payout: PayoutRecord): Promise<void> {}

  async createNotification(_notification: NotificationRecord): Promise<void> {}

  async getCheckoutSessionByIdempotencyKey(_key: string): Promise<CheckoutSessionSnapshot | null> {
    return null;
  }

  async putCheckoutSessionByIdempotencyKey(_snapshot: CheckoutSessionSnapshot): Promise<void> {}

  async getRefundByIdempotencyKey(_key: string): Promise<RefundSnapshot | null> {
    return null;
  }

  async putRefundByIdempotencyKey(_snapshot: RefundSnapshot): Promise<void> {}

  async getProcessedWebhookEvent(_eventId: string): Promise<ProcessedWebhookEvent | null> {
    return null;
  }

  async putProcessedWebhookEvent(_event: ProcessedWebhookEvent): Promise<void> {}

  async getStripeWebhookSigningSecret(): Promise<string> {
    return "";
  }
}
