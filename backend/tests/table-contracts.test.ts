import test from "node:test";
import assert from "node:assert/strict";
import { INDEXES, TABLES } from "../src/repos/table-contracts.js";

test("table contracts include all planned core tables", () => {
  assert.deepEqual(Object.keys(TABLES).sort(), [
    "artists",
    "bookings",
    "categories",
    "invoices",
    "messages",
    "notifications",
    "payouts",
    "reports",
    "roleAssignments",
    "services",
    "systemConfig",
    "users",
  ]);
});

test("index contracts expose required query indexes", () => {
  assert.equal(INDEXES.bookingsByUserCreatedAt, "BookingsByUserCreatedAt");
  assert.equal(INDEXES.bookingsByArtistCreatedAt, "BookingsByArtistCreatedAt");
  assert.equal(INDEXES.messagesByThreadCreatedAt, "MessagesByThreadCreatedAt");
  assert.equal(INDEXES.notificationsByOwnerRead, "NotificationsByOwnerRead");
  assert.equal(INDEXES.artistsByCategoryPopularity, "ArtistsByCategoryPopularity");
  assert.equal(INDEXES.artistsByLocationRating, "ArtistsByLocationRating");
  assert.equal(INDEXES.reportsByStatusType, "ReportsByStatusType");
});
