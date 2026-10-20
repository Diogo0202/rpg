import assert from "node:assert/strict";
import { test } from "node:test";
import { SyncEngine } from "../lib/mobile-sync/engine.ts";
import { MemoryCoordinator, MemorySyncStore } from "../lib/mobile-sync/store.ts";
import { applyChanges, fieldValuesEqual } from "../lib/mobile-sync/merge.ts";
import { FastApiSyncTransport, SyncHttpError, parseRetryAfter } from "../lib/mobile-sync/transport.ts";

const deviceUuid = (name) => `00000000-0000-4000-8000-${String([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)).padStart(12, "0")}`;
const allowed = { map_pins: ["label", "x", "y", "notes"], character_inventory: ["name", "quantity", "notes"] };
let idNumber = 0;
const config = (accountId, campaignId, deviceId, now = () => 1000) => ({ accountId, campaignId, deviceId: deviceUuid(deviceId), entityFields: allowed, now, randomUUID: () => `00000000-0000-4000-8000-${String(++idNumber).padStart(12, "0")}`, retryBaseMs: 0, retryMaxMs: 0 });
const change = (path, before, after) => ({ path: [path], before: { exists: true, value: before }, after: { exists: true, value: after } });

class MemorySyncServer {
  records = new Map(); receipts = new Map(); events = []; revision = 0;
  seed(type, id, data, version = 1) { const record = { entity_type: type, id, version, data: structuredClone(data) }; this.records.set(`${type}/${id}`, record); this.event({ entity_type: type, entity_id: id, action: "create", record }); return record; }
  event(event) { this.events.push({ revision: ++this.revision, version: event.version ?? event.record?.version ?? 0, ...structuredClone(event) }); }
  async push(campaignId, body) {
    const results = [];
    for (const mutation of body.mutations) {
      const hash = JSON.stringify(mutation), receipt = this.receipts.get(mutation.operation_id), key = `${mutation.entity_type}/${mutation.entity_id}`;
      if (receipt) {
        if (receipt.hash !== hash) results.push({ operation_id: mutation.operation_id, status: "invalid", message: "operation ID content mismatch" });
        else results.push({ operation_id: mutation.operation_id, status: "duplicate", record: structuredClone(this.records.get(key) ?? receipt.record) });
        continue;
      }
      let current = this.records.get(key);
      if (mutation.action === "create") {
        if (current) { results.push({ operation_id: mutation.operation_id, status: "conflict", record: structuredClone(current), conflict_paths: mutation.changes.map((c) => c.path) }); continue; }
        const data = applyChanges({}, mutation.changes);
        current = { entity_type: mutation.entity_type, id: mutation.entity_id, version: 1, data };
      } else if (mutation.action === "delete") {
        if (!current || current.version !== mutation.base_version) { results.push({ operation_id: mutation.operation_id, status: "conflict", record: current ? structuredClone(current) : { entity_type: mutation.entity_type, id: mutation.entity_id, version: -1, data: {}, deleted: true } }); continue; }
        current = { entity_type: mutation.entity_type, id: mutation.entity_id, version: current.version + 1, data: {}, deleted: true };
      } else {
        if (!current || current.deleted) { results.push({ operation_id: mutation.operation_id, status: "conflict", record: current ? structuredClone(current) : null }); continue; }
        const bad = mutation.changes.filter((c) => {
          let node = current.data; for (const p of c.path.slice(0, -1)) node = node?.[p];
          const present = node != null && Object.hasOwn(node, c.path.at(-1));
          return !fieldValuesEqual(present ? { exists: true, value: node[c.path.at(-1)] } : { exists: false }, c.before);
        });
        if (bad.length) { results.push({ operation_id: mutation.operation_id, status: "conflict", record: structuredClone(current), conflict_paths: bad.map((c) => c.path) }); continue; }
        current = { ...current, version: current.version + 1, data: applyChanges(current.data, mutation.changes) };
      }
      this.records.set(key, current); this.event({ entity_type: mutation.entity_type, entity_id: mutation.entity_id, version: current.version, action: current.deleted ? "delete" : mutation.action, record: current, ...(current.deleted ? { tombstone: true } : {}) });
      this.receipts.set(mutation.operation_id, { hash, record: structuredClone(current) });
      results.push({ operation_id: mutation.operation_id, status: "applied", record: structuredClone(current) });
    }
    return { protocol_version: 1, campaign_id: campaignId, cursor: String(this.revision), results };
  }
  async changes(campaignId, cursor = "", limit = 100) {
    const offset = Number(cursor || 0), changes = this.events.filter((event) => event.revision > offset).slice(0, limit);
    return { protocol_version: 1, campaign_id: campaignId, cursor: String(changes.at(-1)?.revision ?? offset), has_more: changes.length === limit && this.events.at(-1)?.revision > changes.at(-1)?.revision, changes };
  }
  async snapshot(campaignId, entityType, afterId, limit = 100) {
    const records = [...this.records.values()].filter((r) => r.entity_type === entityType && !r.deleted && (!afterId || r.id > afterId)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
    const has_more = [...this.records.values()].filter((r) => r.entity_type === entityType && !r.deleted && (!afterId || r.id > afterId)).length > records.length;
    return { protocol_version: 1, campaign_id: campaignId, cursor: String(this.revision), records: structuredClone(records), has_more, next_after_id: has_more ? records.at(-1)?.id : null };
  }
}

function client(server, account = "acct-a", device = "device-a", sharedStore = new MemorySyncStore()) {
  return new SyncEngine(config(account, "camp-a", device), sharedStore, server);
}

test("two replicas merge independent fields and preserve same-field edits as conflict", async () => {
  const server = new MemorySyncServer(); server.seed("map_pins", "00000000-0000-4000-8000-000000000101", { label: "Gate", notes: "old" });
  const a = client(server, "acct-a", "device-a"), b = client(server, "acct-a", "device-b");
  const initial = server.records.get("map_pins/00000000-0000-4000-8000-000000000101"); await a.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000101", version: initial.version, action: "upsert", record: initial }); await b.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000101", version: initial.version, action: "upsert", record: initial });
  await a.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000101", action: "update", changes: [change("label", "Gate", "North Gate")] });
  await b.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000101", action: "update", changes: [change("notes", "old", "guarded") ] });
  assert.equal((await a.sync()).applied, 1); assert.equal((await b.sync()).applied, 1);
  assert.equal(server.records.get("map_pins/00000000-0000-4000-8000-000000000101").data.label, "North Gate"); assert.equal(server.records.get("map_pins/00000000-0000-4000-8000-000000000101").data.notes, "guarded");

  const c = client(server, "acct-a", "device-c"), d = client(server, "acct-a", "device-d");
  const latest = structuredClone(server.records.get("map_pins/00000000-0000-4000-8000-000000000101")); await c.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000101", version: latest.version, action: "upsert", record: latest }); await d.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000101", version: latest.version, action: "upsert", record: latest });
  await c.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000101", action: "update", changes: [change("label", "North Gate", "West Gate")] });
  await d.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000101", action: "update", changes: [change("label", "North Gate", "East Gate")] });
  await c.sync(); const report = await d.sync();
  assert.equal(report.conflicts.length, 1); assert.equal((await d.getRecord("map_pins", "00000000-0000-4000-8000-000000000101")).data.label, "East Gate");
  const conflictState = await d.readState(), base = conflictState.records['["map_pins","00000000-0000-4000-8000-000000000101"]'];
  assert.equal(base.data.label, "West Gate");
  const conflictEntry = conflictState.outbox.find((entry) => entry.mutation.operation_id === report.conflicts[0]);
  assert.equal(conflictEntry.state, "conflict");
  assert.deepEqual(conflictEntry.mutation.changes[0], change("label", "North Gate", "East Gate"));
  assert.deepEqual(conflictEntry.mutation.changes[0].before, { exists: true, value: "North Gate" });
  assert.deepEqual(conflictEntry.mutation.changes[0].after, { exists: true, value: "East Gate" });
});

test("map pin delete races are explicit and resolution creates a fresh operation on the remote base", async () => {
  const server = new MemorySyncServer(); server.seed("map_pins", "00000000-0000-4000-8000-000000000102", { label: "Marker", x: 4, y: 7 });
  const deleter = client(server, "acct-a", "device-del"), editor = client(server, "acct-a", "device-edit");
  const base = structuredClone(server.records.get("map_pins/00000000-0000-4000-8000-000000000102")); await deleter.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000102", version: base.version, action: "upsert", record: base }); await editor.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000102", version: base.version, action: "upsert", record: base });
  await deleter.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000102", action: "delete" }); await editor.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000102", action: "update", changes: [change("label", "Marker", "Local marker")] });
  await deleter.sync(); const report = await editor.sync();
  assert.equal(report.conflicts.length, 1); assert.equal((await editor.getRecord("map_pins", "00000000-0000-4000-8000-000000000102")).data.label, "Local marker");
  const state = await editor.readState(), conflict = state.outbox.find((item) => item.state === "conflict");
  const resolved = await editor.resolveConflict(conflict.mutation.operation_id, [{ path: ["label"], before: { exists: false }, after: { exists: true, value: "Local marker" } }]);
  assert.notEqual(resolved.operation_id, conflict.mutation.operation_id); assert.notEqual(resolved.entity_id, conflict.mutation.entity_id); assert.equal(resolved.action, "create"); assert.equal(resolved.base_version, 0);
});

test("a late older tombstone cannot replace a newer snapshot record", async () => {
  const server = new MemorySyncServer(), local = client(server);
  const newer = { entity_type: "map_pins", id: "00000000-0000-4000-8000-000000000106", version: 4, data: { label: "Current" } };
  await local.applyRemote({ entity_type: "map_pins", entity_id: newer.id, version: newer.version, action: "upsert", record: newer });
  await local.applyRemote({ entity_type: "map_pins", entity_id: newer.id, version: 2, action: "delete", tombstone: true });
  const record = await local.getRecord("map_pins", newer.id);
  assert.equal(record.deleted, undefined); assert.equal(record.version, 4); assert.equal(record.data.label, "Current");
});

test("outbox survives engine recreation, partitions accounts, and retries the identical operation ID", async () => {
  const coordinator = new MemoryCoordinator(), storeA = new MemorySyncStore(coordinator), storeB = new MemorySyncStore(coordinator), server = new MemorySyncServer();
  server.seed("character_inventory", "00000000-0000-4000-8000-000000000103", { name: "Potion", quantity: 1, notes: "" });
  const offline = client(server, "acct-a", "device-a", storeA); await offline.applyRemote({ entity_type: "character_inventory", entity_id: "00000000-0000-4000-8000-000000000103", version: server.records.get("character_inventory/00000000-0000-4000-8000-000000000103").version, action: "upsert", record: server.records.get("character_inventory/00000000-0000-4000-8000-000000000103") });
  const pending = await offline.enqueue({ entityType: "character_inventory", entityId: "00000000-0000-4000-8000-000000000103", action: "update", changes: [change("quantity", 1, 2)] });
  await storeA.update(offline.partition, (state) => { state.cursor = "1"; return { result: undefined, state }; });
  server.seed("map_pins", "00000000-0000-4000-8000-000000000107", { label: "Added by another device" });
  const restored = client(server, "acct-a", "device-a", storeA); assert.equal((await restored.readState()).outbox[0].mutation.operation_id, pending.operation_id);
  const otherAccount = client(server, "acct-b", "device-a", storeB); assert.equal((await otherAccount.readState()).outbox.length, 0);

  const calls = []; let drop = true;
  const flakyTransport = { push: async (campaignId, body) => { calls.push(body.mutations.map((m) => m.operation_id)); const result = await server.push(campaignId, body); if (drop) { drop = false; throw Object.assign(new Error("response lost after commit"), { status: 0 }); } return result; }, changes: server.changes.bind(server), snapshot: server.snapshot.bind(server) };
  const retrying = new SyncEngine(config("acct-a", "camp-a", "device-a", () => 10_000), storeA, flakyTransport);
  await retrying.sync(); const afterLost = await retrying.readState(); assert.equal(afterLost.outbox[0].mutation.operation_id, pending.operation_id);
  await retrying.sync(); assert.deepEqual(calls, [[pending.operation_id], [pending.operation_id]]); assert.equal(server.records.get("character_inventory/00000000-0000-4000-8000-000000000103").data.quantity, 2); assert.equal((await retrying.readState()).outbox.length, 0);
  assert.equal((await retrying.readState()).cursor, "1", "push cursor must not skip events from another device");
  await retrying.pull(); assert.equal((await retrying.readState()).cursor, String(server.revision));
  assert.equal((await retrying.getRecord("map_pins", "00000000-0000-4000-8000-000000000107")).data.label, "Added by another device");
});

test("generic duplicate HTTP errors remain retryable and do not acknowledge a mutation", async () => {
  const server = new MemorySyncServer(); server.seed("map_pins", "00000000-0000-4000-8000-000000000104", { label: "A" });
  const local = client(server); await local.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000104", version: server.records.get("map_pins/00000000-0000-4000-8000-000000000104").version, action: "upsert", record: server.records.get("map_pins/00000000-0000-4000-8000-000000000104") });
  await local.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000104", action: "update", changes: [change("label", "A", "B")] });
  const duplicateError = { ...server, push: async () => { throw Object.assign(new Error("duplicate operation rejected"), { status: 409 }); } };
  const engine = new SyncEngine(config("acct-a", "camp-a", "device-a", () => 10000), new MemorySyncStore(), duplicateError);
  await engine.applyRemote({ entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000104", version: server.records.get("map_pins/00000000-0000-4000-8000-000000000104").version, action: "upsert", record: server.records.get("map_pins/00000000-0000-4000-8000-000000000104") });
  await engine.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000104", action: "update", changes: [change("label", "A", "B")] });
  const result = await engine.sync(); assert.equal(result.applied, 0); assert.equal((await engine.readState()).outbox.length, 1);
});

test("rejects polluted paths, duplicate paths, overlaps, and non-whitelisted fields", async () => {
  const server = new MemorySyncServer(), local = client(server);
  await assert.rejects(() => local.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000105", action: "create", changes: [{ path: ["__proto__", "polluted"], before: { exists: false }, after: { exists: true, value: true } }] }));
  await assert.rejects(() => local.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000105", action: "create", changes: [{ path: ["label"], before: { exists: false }, after: { exists: true, value: "x" } }, { path: ["label", "sub"], before: { exists: false }, after: { exists: true, value: "y" } }] }));
  await assert.rejects(() => local.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000105", action: "create", changes: [{ path: ["owner_id"], before: { exists: false }, after: { exists: true, value: "attacker" } }] }));
  assert.equal({}.polluted, undefined);
});

test("transport refreshes once after 401 and keeps bearer values inside request headers", async () => {
  const authCalls = [], seen = []; let requestCount = 0;
  const transport = new FastApiSyncTransport({ baseUrl: "https://api.example.test/", getAccessToken: async (refresh = false) => { authCalls.push(refresh); return refresh ? "fresh-token" : "old-token"; }, fetch: async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization }); requestCount++;
    return requestCount === 1 ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ protocol_version: 1, campaigns: [{ id: "00000000-0000-4000-8000-000000000201", owner_id: "00000000-0000-4000-8000-000000000202", name: "Campaign" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.equal((await transport.listCampaigns())[0].id, "00000000-0000-4000-8000-000000000201");
  assert.deepEqual(authCalls, [false, true]); assert.deepEqual(seen.map((request) => request.auth), ["Bearer old-token", "Bearer fresh-token"]);
});

test("transport maps 403 and bounds Retry-After on 429/503", async () => {
  await assert.rejects(() => new FastApiSyncTransport({ baseUrl: "https://api.example.test", getAccessToken: async () => "token", fetch: async () => new Response("{}", { status: 403 }) }).listCampaigns(), (error) => error instanceof SyncHttpError && error.status === 403 && error.code === "campaign_revoked");
  const sleeps = []; let attempts = 0;
  const transport = new FastApiSyncTransport({ baseUrl: "https://api.example.test", getAccessToken: async () => "token", maxAttempts: 2, retryMaxMs: 900, sleep: async (ms) => sleeps.push(ms), fetch: async () => ++attempts === 1 ? new Response("{}", { status: 429, headers: { "Retry-After": "120" } }) : new Response(JSON.stringify({ protocol_version: 1, campaigns: [] }), { status: 200 }) });
  assert.deepEqual(await transport.listCampaigns(), []); assert.deepEqual(sleeps, [900]);
  assert.equal(parseRetryAfter("120", 0, 500), 500); assert.equal(parseRetryAfter("bad", 0, 500), undefined);
});

test("transport accepts only HTTPS or loopback HTTP and validates server capabilities and JSON", async () => {
  assert.throws(() => new FastApiSyncTransport({ baseUrl: "http://sync.example.test", getAccessToken: async () => "token" }), /HTTPS/);
  assert.throws(() => new FastApiSyncTransport({ baseUrl: "https://user:pass@api.example.test", getAccessToken: async () => "token" }), /credentials/);
  assert.doesNotThrow(() => new FastApiSyncTransport({ baseUrl: "http://127.0.0.1:8000", getAccessToken: async () => "token" }));
  const campaignId = "00000000-0000-4000-8000-000000000201";
  const transport = new FastApiSyncTransport({ baseUrl: "https://api.example.test", getAccessToken: async () => "token", fetch: async () => new Response(JSON.stringify({ protocol_version: 1, campaign_id: campaignId, role: "player", entity_fields: { map_pins: ["label", "x"] } }), { status: 200 }) });
  const capabilities = await transport.capabilities(campaignId);
  assert.equal(capabilities.protocol_version, 1); assert.equal(capabilities.campaign_id, campaignId); assert.equal(capabilities.role, "player"); assert.deepEqual(capabilities.entity_fields.map_pins, ["label", "x"]);
  const poisoned = new FastApiSyncTransport({ baseUrl: "https://api.example.test", getAccessToken: async () => "token", fetch: async () => new Response('{"protocol_version":1,"campaigns":[{"id":"00000000-0000-4000-8000-000000000201","owner_id":"00000000-0000-4000-8000-000000000202","name":"A","__proto__":{"admin":true}}]}', { status: 200 }) });
  await assert.rejects(() => poisoned.listCampaigns(), /forbidden object key/);
});

test("transport preserves API envelope versions, numeric cursors, actions, and tombstone versions", async () => {
  const campaignId = "00000000-0000-4000-8000-000000000203", deviceId = "00000000-0000-4000-8000-000000000204";
  const operation = { operation_id: "00000000-0000-4000-8000-000000000205", entity_type: "map_pins", entity_id: "00000000-0000-4000-8000-000000000206", action: "update", base_version: 1, changes: [change("label", "A", "B")], depends_on: [] };
  let sent;
  const transport = new FastApiSyncTransport({ baseUrl: "https://api.example.test", getAccessToken: async () => "token", fetch: async (url, init) => {
    if (url.endsWith("/sync/push")) { sent = JSON.parse(init.body); return new Response(JSON.stringify({ protocol_version: 1, campaign_id: campaignId, cursor: 12, results: [{ operation_id: operation.operation_id, status: "applied", record: { entity_type: "map_pins", entity_id: operation.entity_id, version: 2, data: { label: "B" } } }] }), { status: 200 }); }
    return new Response(JSON.stringify({ protocol_version: 1, campaign_id: campaignId, cursor: 14, has_more: false, changes: [
      { revision: 13, version: 2, entity_type: "map_pins", entity_id: operation.entity_id, action: "update", record: { entity_type: "map_pins", entity_id: operation.entity_id, version: 3, data: { label: "Latest" } } },
      { revision: 14, version: 4, entity_type: "map_pins", entity_id: operation.entity_id, action: "delete", tombstone: true },
    ] }), { status: 200 });
  } });
  const pushed = await transport.push(campaignId, { protocol_version: 1, device_id: deviceId, mutations: [operation] });
  assert.equal(sent.protocol_version, 1); assert.equal("protocol_version" in sent.mutations[0], false); assert.equal(pushed.cursor, "12");
  const changes = await transport.changes(campaignId, "12"); assert.equal(changes.cursor, "14"); assert.equal(changes.changes[0].version, 2); assert.equal(changes.changes[0].record.version, 3); assert.equal(changes.changes[1].action, "delete"); assert.equal(changes.changes[1].version, 4);
  const staleRecordTransport = new FastApiSyncTransport({ baseUrl: "https://api.example.test", getAccessToken: async () => "token", fetch: async () => new Response(JSON.stringify({ protocol_version: 1, campaign_id: campaignId, cursor: 1, has_more: false, changes: [{ revision: 1, version: 3, entity_type: "map_pins", entity_id: operation.entity_id, action: "update", record: { entity_type: "map_pins", entity_id: operation.entity_id, version: 2, data: { label: "Stale" } } }] }), { status: 200 }) });
  await assert.rejects(() => staleRecordTransport.changes(campaignId, "0"), /identity\/version/);
});

test("upsert applies the current row version while delete uses its tombstone version", async () => {
  const local = client(new MemorySyncServer()), id = "00000000-0000-4000-8000-000000000213";
  await local.applyRemote({ entity_type: "map_pins", entity_id: id, version: 2, action: "upsert", record: { entity_type: "map_pins", id, version: 3, data: { label: "Current row" } } });
  assert.equal((await local.getRecord("map_pins", id)).version, 3);
  await local.applyRemote({ entity_type: "map_pins", entity_id: id, version: 4, action: "delete", tombstone: true, record: { entity_type: "map_pins", id, version: 5, data: { label: "Must not survive delete" } } });
  const tombstone = await local.getRecord("map_pins", id);
  assert.equal(tombstone.deleted, true); assert.equal(tombstone.version, 4);
});

test("a remote tombstone conflicts with a pending edit and preserves its before/after draft", async () => {
  const server = new MemorySyncServer(), id = "00000000-0000-4000-8000-000000000214";
  const original = server.seed("map_pins", id, { label: "Old label" });
  const editor = client(server, "acct-a", "device-editor"), deleter = client(server, "acct-a", "device-deleter");
  await editor.applyRemote({ entity_type: original.entity_type, entity_id: id, version: original.version, action: "upsert", record: original });
  await deleter.applyRemote({ entity_type: original.entity_type, entity_id: id, version: original.version, action: "upsert", record: original });
  const pending = await editor.enqueue({ entityType: "map_pins", entityId: id, action: "update", changes: [change("label", "Old label", "Unsynced label")] });
  await deleter.enqueue({ entityType: "map_pins", entityId: id, action: "delete" });
  assert.equal((await deleter.sync()).applied, 1);
  await editor.pull();
  const state = await editor.readState(), base = state.records['["map_pins","00000000-0000-4000-8000-000000000214"]'];
  assert.equal(base.deleted, true); assert.equal(base.version, 2);
  const draft = state.outbox.find((entry) => entry.mutation.operation_id === pending.operation_id);
  assert.equal(draft.state, "conflict");
  assert.deepEqual(draft.mutation.changes[0].before, { exists: true, value: "Old label" });
  assert.deepEqual(draft.mutation.changes[0].after, { exists: true, value: "Unsynced label" });
  assert.equal((await editor.getRecord("map_pins", id)).data.label, "Unsynced label");
  const report = await editor.sync();
  assert.deepEqual(report.conflicts, [pending.operation_id]); assert.equal(report.blocked, true);
});

test("403 from pull clears confirmed cache and cursor while retaining denied edits", async () => {
  const id = "00000000-0000-4000-8000-000000000215", store = new MemorySyncStore(), server = new MemorySyncServer();
  const original = server.seed("map_pins", id, { label: "Server value" }), baseClient = client(server, "acct-a", "device-a", store);
  await baseClient.applyRemote({ entity_type: original.entity_type, entity_id: id, version: original.version, action: "upsert", record: original });
  await baseClient.enqueue({ entityType: "map_pins", entityId: id, action: "update", changes: [change("label", "Server value", "Local draft")] });
  await store.update(baseClient.partition, (state) => { state.cursor = "1"; return { result: undefined, state }; });
  const revoked = new SyncEngine(config("acct-a", "camp-a", "device-a"), store, {
    push: server.push.bind(server), snapshot: server.snapshot.bind(server),
    changes: async () => { throw Object.assign(new Error("campaign access revoked"), { status: 403 }); },
  });
  await assert.rejects(() => revoked.pull(), (error) => error.status === 403);
  const state = await revoked.readState();
  assert.deepEqual(state.records, {}); assert.equal(state.cursor, null); assert.equal(state.outbox[0].state, "denied");
  assert.equal((await revoked.getRecord("map_pins", id)).data.label, "Local draft");
});

test("403 during snapshot bootstrap clears partial cache and preserves the outbox draft", async () => {
  const id = "00000000-0000-4000-8000-000000000216", store = new MemorySyncStore(), server = new MemorySyncServer();
  const original = server.seed("map_pins", id, { label: "Server value" }), baseClient = client(server, "acct-a", "device-a", store);
  await baseClient.applyRemote({ entity_type: original.entity_type, entity_id: id, version: original.version, action: "upsert", record: original });
  await baseClient.enqueue({ entityType: "map_pins", entityId: id, action: "update", changes: [change("label", "Server value", "Local draft")] });
  const revoked = new SyncEngine(config("acct-a", "camp-a", "device-a"), store, {
    push: server.push.bind(server), changes: server.changes.bind(server),
    snapshot: async () => { throw Object.assign(new Error("campaign access revoked"), { status: 403 }); },
  });
  await assert.rejects(() => revoked.bootstrap(["map_pins"]), (error) => error.status === 403);
  const state = await revoked.readState();
  assert.deepEqual(state.records, {}); assert.equal(state.cursor, null); assert.equal(state.outbox[0].state, "denied");
  assert.equal((await revoked.getRecord("map_pins", id)).data.label, "Local draft");
});

test("403 clears confirmed cache and keeps denied drafts available for export", async () => {
  const server = new MemorySyncServer(); server.seed("map_pins", "00000000-0000-4000-8000-000000000108", { label: "Private" });
  const store = new MemorySyncStore(), local = client(server, "acct-a", "device-a", store);
  const record = server.records.get("map_pins/00000000-0000-4000-8000-000000000108"); await local.applyRemote({ entity_type: record.entity_type, entity_id: record.id, version: record.version, action: "upsert", record });
  await local.enqueue({ entityType: "map_pins", entityId: record.id, action: "update", changes: [change("label", "Private", "Local draft")] });
  const revoked = { push: async () => { throw Object.assign(new Error("membership revoked"), { status: 403 }); }, changes: server.changes.bind(server), snapshot: server.snapshot.bind(server) };
  const engine = new SyncEngine(config("acct-a", "camp-a", "device-a"), store, revoked);
  const report = await engine.sync(), state = await engine.readState();
  assert.equal(report.reason, "revoked"); assert.equal(Object.keys(state.records).length, 0); assert.equal(state.outbox[0].state, "denied");
  assert.equal((await engine.getRecord("map_pins", record.id)).data.label, "Local draft");
  assert.equal((await engine.exportPendingDrafts()).format, "rpg-nexus-mobile-v1-pending-drafts");
});

test("offline create, edits, and delete chain predicted versions before the first push", async () => {
  const server = new MemorySyncServer(), local = client(server);
  const created = await local.enqueue({ entityType: "map_pins", action: "create", changes: [{ path: ["label"], before: { exists: false }, after: { exists: true, value: "Start" } }] });
  const edited = await local.enqueue({ entityType: "map_pins", entityId: created.entity_id, action: "update", changes: [change("label", "Start", "Edited")] });
  const editedAgain = await local.enqueue({ entityType: "map_pins", entityId: created.entity_id, action: "update", changes: [change("label", "Edited", "Final")] });
  const deleted = await local.enqueue({ entityType: "map_pins", entityId: created.entity_id, action: "delete" });
  assert.deepEqual([created.base_version, edited.base_version, editedAgain.base_version, deleted.base_version], [0, 1, 2, 3]);
  assert.equal((await local.getRecord("map_pins", created.entity_id)).version, 4);
  assert.equal((await local.sync()).applied, 4);
  assert.equal(server.records.get(`map_pins/${created.entity_id}`).deleted, true);
  assert.equal(server.records.get(`map_pins/${created.entity_id}`).version, 4);
});

test("accepted push without a record remains projected until pull confirms it", async () => {
  const store = new MemorySyncStore(), server = new MemorySyncServer();
  const recorder = client(server, "acct-a", "device-a", store);
  await store.update(recorder.partition, (state) => { state.cursor = "0"; return { result: undefined, state }; });
  const transport = {
    push: async (_campaign, body) => ({ cursor: "1", results: body.mutations.map((m) => ({ operation_id: m.operation_id, status: "applied" })) }),
    changes: server.changes.bind(server), snapshot: server.snapshot.bind(server),
  };
  const local = new SyncEngine(config("acct-a", "camp-a", "device-a"), store, transport);
  const mutation = await local.enqueue({ entityType: "map_pins", entityId: "00000000-0000-4000-8000-000000000210", action: "create", changes: [{ path: ["label"], before: { exists: false }, after: { exists: true, value: "Accepted" } }] });
  assert.equal((await local.sync()).applied, 1);
  assert.equal((await local.readState()).outbox[0].state, "accepted");
  assert.equal((await local.getRecord("map_pins", mutation.entity_id)).data.label, "Accepted");
  assert.equal((await local.sync()).sent, 0);
  server.seed("map_pins", mutation.entity_id, { label: "Accepted" });
  await local.pull();
  assert.equal((await local.readState()).outbox.length, 0);
  assert.equal((await local.getRecord("map_pins", mutation.entity_id)).version, 1);
});

test("older push acknowledgement cannot replace a newer pulled base", async () => {
  const store = new MemorySyncStore(), id = "00000000-0000-4000-8000-000000000211";
  const local = client(new MemorySyncServer(), "acct-a", "device-a", store);
  await local.applyRemote({ entity_type: "map_pins", entity_id: id, version: 1, action: "upsert", record: { entity_type: "map_pins", id, version: 1, data: { label: "A" } } });
  await local.enqueue({ entityType: "map_pins", entityId: id, action: "update", changes: [change("label", "A", "B")] });
  const staleAck = { push: async (_campaign, body) => ({ results: body.mutations.map((m) => ({ operation_id: m.operation_id, status: "applied", record: { entity_type: "map_pins", id, version: 2, data: { label: "B" } } })) }), changes: async () => ({ cursor: "0", has_more: false, changes: [] }), snapshot: async () => ({ cursor: "0", records: [], has_more: false, next_after_id: null }) };
  const staleEngine = new SyncEngine(config("acct-a", "camp-a", "device-a"), store, staleAck);
  const originalPush = staleAck.push;
  staleAck.push = async (...args) => {
    await staleEngine.applyRemote({ entity_type: "map_pins", entity_id: id, version: 3, action: "upsert", record: { entity_type: "map_pins", id, version: 3, data: { label: "Remote newer" } } });
    return originalPush(...args);
  };
  await staleEngine.sync();
  const saved = (await staleEngine.readState()).records['["map_pins","00000000-0000-4000-8000-000000000211"]'];
  assert.equal(saved.version, 3); assert.equal(saved.data.label, "Remote newer");
});

test("a database lease prevents a second replica from sending during an in-flight request", async () => {
  const coordinator = new MemoryCoordinator(), storeA = new MemorySyncStore(coordinator), storeB = new MemorySyncStore(coordinator), server = new MemorySyncServer();
  const id = "00000000-0000-4000-8000-000000000212", first = client(server, "acct-a", "device-a", storeA);
  const record = server.seed("map_pins", id, { label: "A" });
  await first.applyRemote({ entity_type: "map_pins", entity_id: id, version: 1, action: "upsert", record });
  await first.enqueue({ entityType: "map_pins", entityId: id, action: "update", changes: [change("label", "A", "B")] });
  let startPush, finishPush;
  const started = new Promise((resolve) => { startPush = resolve; }), finished = new Promise((resolve) => { finishPush = resolve; });
  const slowTransport = { push: async (campaign, body) => { startPush(); await finished; return server.push(campaign, body); }, changes: server.changes.bind(server), snapshot: server.snapshot.bind(server) };
  const sender = new SyncEngine(config("acct-a", "camp-a", "device-a"), storeA, slowTransport);
  const observer = new SyncEngine(config("acct-a", "camp-a", "device-a"), storeB, server);
  const sending = sender.sync(); await started;
  const blocked = await observer.sync();
  assert.equal(blocked.blocked, true); assert.equal(blocked.sent, 0);
  finishPush(); await sending;
  assert.equal(server.receipts.size, 1);
});



