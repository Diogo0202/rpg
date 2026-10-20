import test from "node:test";
import assert from "node:assert/strict";
import { sessionAccessEvent } from "../lib/server-access-audit.ts";

test("session audit includes only validated identity and a fixed area", () => {
  const id = "30000000-0000-4000-8000-000000000001";
  const event = sessionAccessEvent("/app/campaign/private-secret?token=credential", "GET", id, "checked", id);
  assert.equal(event.actor_id, id);
  assert.equal(event.area, "campaign_workspace");
  assert.equal(event.phase, "session_check");
  assert.doesNotMatch(JSON.stringify(event), /private-secret|token|credential/);
});

test("invalid identity and methods cannot forge audit fields", () => {
  const event = sessionAccessEvent("/auth/callback", "GET\nsecret", "admin\nsecret", "unavailable", "forged");
  assert.equal(event.actor_id, null);
  assert.equal(event.request_id, null);
  assert.equal(event.method, "OTHER");
  assert.equal(sessionAccessEvent("/", "GET", null, "checked", ""), null);
  assert.equal(sessionAccessEvent("/application", "GET", null, "checked", ""), null);
});
