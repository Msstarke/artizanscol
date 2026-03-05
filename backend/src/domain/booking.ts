export const BOOKING_STATUSES = [
  "requested",
  "accepted",
  "declined",
  "confirmed",
  "payment_pending",
  "paid",
  "completed",
  "cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  requested: ["accepted", "declined", "cancelled"],
  accepted: ["confirmed", "cancelled"],
  declined: [],
  confirmed: ["payment_pending", "paid", "cancelled"],
  payment_pending: ["paid", "cancelled"],
  paid: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isBookingStatus(value: string): value is BookingStatus {
  return BOOKING_STATUSES.includes(value as BookingStatus);
}

export function canTransitionBookingStatus(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}
