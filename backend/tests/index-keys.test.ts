import test from "node:test";
import assert from "node:assert/strict";
import { categoryActiveStatus, categorySortName, ownerReadKey } from "../src/domain/index-keys.js";

test("ownerReadKey composes owner/read key for notification GSI", () => {
  assert.equal(ownerReadKey("u_1", true), "u_1#read");
  assert.equal(ownerReadKey("u_1", false), "u_1#unread");
});

test("categoryActiveStatus maps boolean active to index status", () => {
  assert.equal(categoryActiveStatus(true), "active");
  assert.equal(categoryActiveStatus(false), "inactive");
});

test("categorySortName normalizes category names for deterministic index sort", () => {
  assert.equal(categorySortName("  Character   Design  "), "character design");
});
