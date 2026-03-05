import test from "node:test";
import assert from "node:assert/strict";
import { createRecordMeta, touchRecordMeta } from "../src/domain/record-meta.js";

test("createRecordMeta initializes canonical persisted fields", () => {
  const meta = createRecordMeta({
    id: "u_123",
    createdBy: "sub_abc",
    now: "2026-03-05T00:00:00.000Z",
  });

  assert.deepEqual(meta, {
    id: "u_123",
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
    createdBy: "sub_abc",
    version: 1,
  });
});

test("touchRecordMeta bumps version and updatedAt", () => {
  const original = createRecordMeta({
    id: "u_123",
    createdBy: "sub_abc",
    now: "2026-03-05T00:00:00.000Z",
  });

  const updated = touchRecordMeta(original, "sub_xyz", "2026-03-06T01:02:03.000Z");

  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.updatedAt, "2026-03-06T01:02:03.000Z");
  assert.equal(updated.createdBy, original.createdBy);
  assert.equal(updated.version, 2);
});
