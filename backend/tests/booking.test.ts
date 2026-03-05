import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  canTransitionBookingStatus,
  isBookingStatus,
} from "../src/domain/booking.js";

test("BOOKING_STATUSES exposes expected lifecycle states", () => {
  assert.deepEqual(BOOKING_STATUSES, [
    "requested",
    "accepted",
    "declined",
    "confirmed",
    "payment_pending",
    "paid",
    "completed",
    "cancelled",
  ]);
});

test("isBookingStatus validates status strings", () => {
  assert.equal(isBookingStatus("requested"), true);
  assert.equal(isBookingStatus("unknown"), false);
});

test("canTransitionBookingStatus enforces transition map", () => {
  assert.equal(canTransitionBookingStatus("requested", "accepted"), true);
  assert.equal(canTransitionBookingStatus("requested", "paid"), false);
  assert.equal(canTransitionBookingStatus("paid", "completed"), true);
  assert.equal(canTransitionBookingStatus("cancelled", "requested"), false);

  assert.deepEqual(BOOKING_TRANSITIONS.requested, ["accepted", "declined", "cancelled"]);
});
