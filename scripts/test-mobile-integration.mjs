import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase } from "./test-db.mjs";
import { SyncEngine, MemorySyncStore, FastApiSyncTransport } from "../frontend/lib/mobile-sync/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = crypto.randomUUID(), player = crypto.randomUUID(), newOwner = crypto.randomUUID(), outsider = crypto.randomUUID();
const campaign = crypto.randomUUID(), template = crypto.randomUUID();
const actors = new Set([owner, player, outsider]);
const { db } = await createTestDatabase({ through: "20261018200000_mobile_sync.sql" });
const checked = [];
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const field = (path, before, after) => ({ path, before: before === undefined ? { exists: false } : { exists: true, value: before }, after: after === undefined ? { exists: false } : { exists: true, value: after } });

const schema = { name: "Modelo de teste", version: 1, fields: [
  { id: "nome", label: "Nome", kind: "text", required: true, options: [], expression: null, character_name: true },
  { id: "vigor", label: "Vigor", kind: "number", required: true, options: [], expression: null },
  { id: "vida", label: "Vida", kind: "formula", required: false, options: [], expression: "vigor + 3" },
] };
actors.add(newOwner);
for (const id of actors) await db.query("insert into auth.users(id,aud,role,email) values($1,'authenticated','authenticated',$2)", [id, `${id}@example.test`]);
await db.query("insert into public.campaigns(id,owner_id,name) values($1,$2,'Integração mobile')", [campaign, owner]);
await db.query("insert into public.campaign_members(campaign_id,user_id,role) values($1,$2,'player')", [campaign, player]);
await db.query("insert into public.system_templates(id,campaign_id,owner_id,name,status,schema) values($1,$2,$3,'Modelo de teste','approved',$4::jsonb)", [template, campaign, owner, JSON.stringify(schema)]);

const tables = new Map();
for (const row of (await db.query("select table_name,column_name from information_schema.columns where table_schema='public'")).rows) {
  if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
  tables.get(row.table_name).add(row.column_name);
}
const rpcArguments = {
  mobile_sync_push: ["p_campaign_id", "p_device_id", "p_mutations"],
  mobile_sync_snapshot: ["p_campaign_id", "p_entity_type", "p_after_id", "p_limit"],
  mobile_sync_changes: ["p_campaign_id", "p_cursor", "p_limit"],
};
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const bridge = createServer(async (req, res) => {
  const respond = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const actor = req.headers.authorization?.replace(/^Bearer test:/, "");
  if (!actors.has(actor)) return respond(401, { message: "test session required" });
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/auth/v1/user") return respond(200, { id: actor });
  try {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : null;
    const result = await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      const name = url.pathname.replace(/^\/rest\/v1\//, "");
      if (req.method === "POST" && name.startsWith("rpc/")) {
        const fn = name.slice(4), keys = rpcArguments[fn];
        if (!keys) throw new Error("test RPC is not allowed");
        const args = keys.map((key) => body[key]);
        if (fn === "mobile_sync_push") args[2] = JSON.stringify(args[2]);
        return (await tx.query(`select public.${quote(fn)}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result;
      }
      if (req.method !== "GET" || !tables.has(name)) throw new Error("test REST resource is not allowed");
      const columns = tables.get(name), selection = (url.searchParams.get("select") ?? "*").split(",");
      if (selection.some((column) => column !== "*" && !columns.has(column))) throw new Error("unknown test column");
      const conditions = [], args = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit"].includes(key)) continue;
        if (!columns.has(key) || !value.startsWith("eq.")) throw new Error("unsupported test REST filter");
        args.push(value.slice(3)); conditions.push(`${quote(key)}=$${args.length}`);
      }
      const sql = `select ${selection.map((column) => column === "*" ? "*" : quote(column)).join(",")} from public.${quote(name)}${conditions.length ? ` where ${conditions.join(" and ")}` : ""} limit ${Math.min(500, Number(url.searchParams.get("limit") ?? 500))}`;
      return (await tx.query(sql, args)).rows;
    });
    respond(200, result);
  } catch (error) {
    respond(error.code === "42501" ? 403 : 400, { message: "local SQL fixture rejected request", code: error.code ?? "TEST" });
  }
});

const bridgePort = await listen(bridge), reservation = createServer();
const apiPort = await listen(reservation); await close(reservation);
let output = "";
const api = spawn(path.join(root, "backend/.venv/Scripts/python.exe"), ["-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", String(apiPort), "--no-access-log"], {
  cwd: root,
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${bridgePort}`, SUPABASE_PUBLISHABLE_KEY: "test-publishable-key", SUPABASE_SERVICE_ROLE_KEY: "", API_CONCURRENCY_BACKEND: "process", VERCEL: "", AWS_LAMBDA_FUNCTION_NAME: "", K_SERVICE: "", WEB_CONCURRENCY: "1" },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
for (const stream of [api.stdout, api.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
const baseUrl = `http://127.0.0.1:${apiPort}`;
try {
  let ready = false;
  for (let index = 0; index < 100; index++) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) { ready = true; break; } } catch { /* wait for test server */ }
    if (api.exitCode !== null) break;
    await sleep(100);
  }
  assert(ready, `API did not start: ${output}`);
  const transport = (actorId) => new FastApiSyncTransport({ baseUrl, getAccessToken: async () => `test:${actorId}`, maxAttempts: 1 });
  const wire = transport(player), caps = await wire.capabilities(campaign);
  assert.equal(caps.role, "player"); assert(caps.entity_fields.character_sheets);
  const storeLeft = new MemorySyncStore(), storeRight = new MemorySyncStore();
  const makeEngine = async (store) => new SyncEngine({ accountId: player, campaignId: campaign, deviceId: await store.getOrCreateDeviceId(player), entityFields: caps.entity_fields }, store, wire);
  const left = await makeEngine(storeLeft), right = await makeEngine(storeRight);
  await left.bootstrap(["character_sheets"]); await right.bootstrap(["character_sheets"]);
  const sheetId = crypto.randomUUID();
  const created = await left.enqueue({ entityType: "character_sheets", entityId: sheetId, action: "create", changes: [field(["name"], undefined, "Mara"), field(["template_id"], undefined, template), field(["values"], undefined, { nome: "Mara", vigor: 2 })] });
  const createdReport = await left.sync();
  assert.equal(createdReport.applied, 1, JSON.stringify(await left.readState()));
  const replay = await wire.push(campaign, { protocol_version: 1, device_id: left.partition.deviceId, mutations: [created] });
  assert.equal(replay.results[0].status, "duplicate");
  assert.equal((await db.query("select count(*)::integer as count from public.character_sheets where id=$1", [sheetId])).rows[0].count, 1);
  checked.push("actual TypeScript -> FastAPI -> PostgreSQL: creation and duplicate receipt");

  const inventoryId = crypto.randomUUID();
  const inventoryCreate = await left.enqueue({ entityType: "character_inventory", entityId: inventoryId, action: "create", changes: [
    field(["sheet_id"], undefined, sheetId), field(["name"], undefined, "Corda de seda"),
    field(["category"], undefined, "equipment"), field(["quantity"], undefined, 1),
  ] });
  assert.equal((await left.sync()).applied, 1);
  const inventoryReplay = await wire.push(campaign, { protocol_version: 1, device_id: left.partition.deviceId, mutations: [inventoryCreate] });
  assert.equal(inventoryReplay.results[0].status, "duplicate");
  assert.equal((await db.query("select count(*)::integer as count from public.character_inventory where id=$1", [inventoryId])).rows[0].count, 1);
  checked.push("inventory creation and duplicate receipt preserve one row");

  await right.pull(); await left.pull();
  await left.enqueue({ entityType: "character_sheets", entityId: sheetId, action: "update", changes: [field(["values", "vigor"], 2, 3)] });
  await right.enqueue({ entityType: "character_sheets", entityId: sheetId, action: "update", changes: [field(["name"], "Mara", "Maria"), field(["values", "nome"], "Mara", "Maria")] });
  assert.equal((await left.sync()).applied, 1); assert.equal((await right.sync()).applied, 1);
  await left.pull(); await right.pull();
  assert.equal((await left.getRecord("character_sheets", sheetId)).data.values.vigor, 3);
  assert.equal((await right.getRecord("character_sheets", sheetId)).data.name, "Maria");
  checked.push("independent field changes merge across two replicas");
  await left.enqueue({ entityType: "character_sheets", entityId: sheetId, action: "update", changes: [field(["values", "vigor"], 3, 4)] });
  await right.enqueue({ entityType: "character_sheets", entityId: sheetId, action: "update", changes: [field(["values", "vigor"], 3, 5)] });
  assert.equal((await left.sync()).applied, 1);
  const conflict = await right.sync(); assert.equal(conflict.conflicts.length, 1);
  assert.equal((await right.getRecord("character_sheets", sheetId)).data.values.vigor, 5);
  await right.resolveConflict(conflict.conflicts[0], [field(["values", "vigor"], 4, 5)]);
  assert.equal((await right.sync()).applied, 1);
  checked.push("same-field conflict preserves local editing and explicit resolution");

  await left.pull();
  await db.query("insert into public.campaign_members(campaign_id,user_id,role) values($1,$2,'player')", [campaign, newOwner]);
  const newMemberCaps = await transport(newOwner).capabilities(campaign);
  assert.equal(newMemberCaps.role, "player");
  const oldOwnerSheetBefore = await left.getRecord("character_sheets", sheetId);
  const oldOwnerInventoryBefore = await left.getRecord("character_inventory", inventoryId);
  await left.enqueue({ entityType: "character_sheets", entityId: sheetId, action: "update", changes: [field(["values", "vigor"], oldOwnerSheetBefore.data.values.vigor, 6)] });
  await left.enqueue({ entityType: "character_inventory", entityId: inventoryId, action: "update", changes: [field(["quantity"], oldOwnerInventoryBefore.data.quantity, 2)] });

  const managerWire = transport(owner), managerCaps = await managerWire.capabilities(campaign);
  assert.equal(managerCaps.role, "owner");
  const managerStore = new MemorySyncStore();
  const manager = new SyncEngine({ accountId: owner, campaignId: campaign, deviceId: await managerStore.getOrCreateDeviceId(owner), entityFields: managerCaps.entity_fields }, managerStore, managerWire);
  await manager.bootstrap(["character_sheets", "character_inventory"]);
  const managerCursor = (await manager.readState()).cursor;

  await db.query("update public.character_sheets set owner_id=$1 where id=$2", [newOwner, sheetId]);
  await left.pull();
  const formerOwnerState = await left.readState();
  const formerSheet = formerOwnerState.records[JSON.stringify(["character_sheets", sheetId])];
  const formerInventory = formerOwnerState.records[JSON.stringify(["character_inventory", inventoryId])];
  assert.equal(formerSheet.deleted, true); assert.equal(formerInventory.deleted, true);
  for (const [entityType, entityId, path, expectedBefore, expectedAfter] of [
    ["character_sheets", sheetId, ["values", "vigor"], 5, 6],
    ["character_inventory", inventoryId, ["quantity"], 1, 2],
  ]) {
    const entry = formerOwnerState.outbox.find((item) => item.mutation.entity_type === entityType && item.mutation.entity_id === entityId);
    assert.equal(entry.state, "conflict");
    assert.deepEqual(entry.mutation.changes[0], field(path, expectedBefore, expectedAfter));
  }
  assert.equal((await left.getRecord("character_sheets", sheetId)).data.values.vigor, 6);
  assert.equal((await left.getRecord("character_inventory", inventoryId)).data.quantity, 2);
  checked.push("ownership transfer tombstones old cache and preserves both local drafts as conflicts");

  const newOwnerStore = new MemorySyncStore();
  const newOwnerEngine = new SyncEngine({ accountId: newOwner, campaignId: campaign, deviceId: await newOwnerStore.getOrCreateDeviceId(newOwner), entityFields: newMemberCaps.entity_fields }, newOwnerStore, transport(newOwner));
  await newOwnerEngine.bootstrap(["character_sheets", "character_inventory"]);
  assert.equal((await newOwnerEngine.getRecord("character_sheets", sheetId)).data.values.vigor, 5);
  assert.equal((await newOwnerEngine.getRecord("character_inventory", inventoryId)).data.quantity, 1);
  const managerChanges = await managerWire.changes(campaign, managerCursor, 100);
  assert(!managerChanges.changes.some((event) => event.action === "delete" && [sheetId, inventoryId].includes(event.entity_id)));
  assert(managerChanges.changes.some((event) => event.entity_type === "character_sheets" && event.entity_id === sheetId && event.action === "update"));
  checked.push("new owner snapshot contains transferred rows while manager receives no old-owner tombstone");

  await assert.rejects(transport(outsider).snapshot(campaign, "character_sheets"), (error) => error.status === 403);
  await db.query("delete from public.campaign_members where campaign_id=$1 and user_id=$2", [campaign, player]);
  await right.enqueue({ entityType: "character_sheets", entityId: sheetId, action: "update", changes: [field(["values", "vigor"], 5, 6)] });
  const denied = await right.sync(); assert.equal(denied.blocked, true);
  assert.equal(Object.keys((await right.readState()).records).length, 0);
  checked.push("RLS isolation and revoked membership clear confirmed cache, preserving denied drafts");
  console.log(JSON.stringify({ passed: true, checks: checked, scope: "local PGlite/PostgreSQL with Auth/Storage fixture; actual FastAPI and TypeScript transport; no hosted Supabase" }, null, 2));
} catch (error) {
  console.error(error);
  console.error(output.slice(-2500));
  process.exitCode = 1;
} finally {
  api.kill();
  await new Promise((resolve) => api.exitCode !== null ? resolve() : api.once("exit", resolve));
  await close(bridge); await db.close();
}
