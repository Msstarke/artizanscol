import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "../src/handlers/health.js";

test("health handler returns ApiSuccess payload", async () => {
  const response = await handler({} as never);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body);

  const parsed = JSON.parse(String(response.body));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.service, "artizans-backend");
  assert.equal(parsed.data.status, "ok");
});
