import test from "node:test";
import assert from "node:assert/strict";
import { extractAuthIdentity, requireAuthIdentity } from "../src/middleware/auth-context.js";
import { NoopRoleAssignmentsRepository } from "../src/repos/role-assignments.js";

test("extractAuthIdentity returns null when sub claim is missing", async () => {
  const identity = await extractAuthIdentity({ requestContext: {} } as never);
  assert.equal(identity, null);
});

test("extractAuthIdentity reads JWT claims and default roles", async () => {
  const identity = await extractAuthIdentity(
    {
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: "user-1",
              email: "person@example.com",
              "cognito:username": "person",
            },
          },
        },
      },
    } as never,
  );

  assert.ok(identity);
  assert.equal(identity?.sub, "user-1");
  assert.equal(identity?.email, "person@example.com");
  assert.equal(identity?.username, "person");
  assert.deepEqual(identity?.roles, ["user", "artist"]);
});

test("extractAuthIdentity uses roles from claims and role assignment repository", async () => {
  const repo = new NoopRoleAssignmentsRepository();
  repo.listRolesForSubject = async () => ["admin"];

  const identity = await extractAuthIdentity(
    {
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: "artist-1",
              "custom:roles": "artist",
            },
          },
        },
      },
    } as never,
    repo,
  );

  assert.ok(identity);
  assert.deepEqual(identity?.roles.sort(), ["admin", "artist", "user"]);
});

test("requireAuthIdentity throws when request is unauthenticated", async () => {
  await assert.rejects(
    () => requireAuthIdentity({ requestContext: {} } as never),
    /Authentication is required/,
  );
});
