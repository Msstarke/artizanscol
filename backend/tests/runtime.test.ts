import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeArtistWriteRecord } from "../src/repos/runtime.js";
import { createRecordMeta } from "../src/domain/record-meta.js";
import type { ArtistRecord } from "../src/domain/entities.js";

test("sanitizeArtistWriteRecord removes blank indexed artist attributes", () => {
  const artist: ArtistRecord = {
    ...createRecordMeta({ id: "a1", createdBy: "seed", now: "2026-03-12T00:00:00.000Z" }),
    cognitoSub: "sub-1",
    cognitoEmail: "artist@example.com",
    name: "Artist",
    handle: "artist",
    category: "",
    mediums: [],
    location: "",
    verified: false,
    popularity: 0,
    rating: 0,
    reviewCount: 0,
    priceFrom: 0,
    availability: "open",
    bio: "",
    profileVisible: false,
    profileViews: 0,
    completedBookings: 0,
    acceptanceRate: 0,
    portfolio: [],
  };

  const payload = sanitizeArtistWriteRecord(artist);

  assert.equal("category" in payload, false);
  assert.equal("location" in payload, false);
  assert.equal(payload.handle, "artist");
  assert.equal(payload.profileVisible, false);
});
