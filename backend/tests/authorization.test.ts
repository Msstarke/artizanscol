import test from "node:test";
import assert from "node:assert/strict";
import type { AuthIdentity } from "../src/domain/auth.js";
import { requireAdmin, requireAnyRole, requireOwnership } from "../src/middleware/authorization.js";

const baseIdentity: AuthIdentity = {
  sub: "sub-1",
  email: "person@example.com",
  username: "person",
  roles: ["user", "artist"],
  claims: { sub: "sub-1" },
};

test("requireAnyRole allows when user has one allowed role", () => {
  assert.doesNotThrow(() => requireAnyRole(baseIdentity, ["artist"]));
});

test("requireAnyRole throws when user lacks required roles", () => {
  assert.throws(() => requireAnyRole(baseIdentity, ["admin"]), /permission/);
});

test("requireAdmin enforces admin role", () => {
  assert.throws(() => requireAdmin(baseIdentity), /permission/);
  assert.doesNotThrow(() =>
    requireAdmin({
      ...baseIdentity,
      roles: ["admin"],
    }),
  );
});

test("requireOwnership enforces subject ownership and allows admin override", () => {
  assert.doesNotThrow(() => requireOwnership(baseIdentity, "sub-1"));
  assert.throws(() => requireOwnership(baseIdentity, "sub-2"), /own this resource/);
  assert.doesNotThrow(() =>
    requireOwnership(
      {
        ...baseIdentity,
        roles: ["admin"],
      },
      "sub-2",
    ),
  );
});
