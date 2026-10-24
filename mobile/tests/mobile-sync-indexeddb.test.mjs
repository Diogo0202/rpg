import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, "../src/lib/mobile-sync/store.ts");
const transportPath = join(here, "../src/lib/mobile-sync/transport.ts");
const mergePath = join(here, "../src/lib/mobile-sync/merge.ts");
const require = createRequire(import.meta.url);

async function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) {
    try { return await import(name); } catch { /* try the bundled runtime below */ }
  }
  const nodeModules = process.env.CODEX_NODE_MODULES ?? "C:/Users/digme/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
  for (const name of ["playwright", "playwright-core"]) {
    try { return await import(pathToFileURL(join(nodeModules, name, "index.mjs")).href); } catch { /* continue */ }
  }
  return null;
}

test("IndexedDB persists partitions and serializes writes across store instances and reloads", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright) { t.skip("Playwright is not installed in this environment"); return; }
  let browser;
  try { browser = await playwright.chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message}`); return; }
  const ts = require("typescript");
  const source = await readFile(sourcePath, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const pageHtml = `<!doctype html><meta charset="utf-8"><script>(()=>{const exports={};${js}\n;window.mobileSyncModule=exports})()</script>`;
  const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(pageHtml); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const dbName = `mobile-sync-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await page.evaluate(async (name) => {
      const { IndexedDbSyncStore } = window.mobileSyncModule;
      const partition = { accountId: "account-1", campaignId: "campaign-1", deviceId: "device-1" };
      const first = new IndexedDbSyncStore(name), second = new IndexedDbSyncStore(name);
      const deviceId = await first.getOrCreateDeviceId("account-1");
      if (deviceId !== await second.getOrCreateDeviceId("account-1")) throw new Error("device ID changed across store instances");
      await first.update(partition, (state) => { state.outbox.push({ mutation: { operation_id: "stable-operation", action: "update" }, state: "queued", attempts: 0, createdAt: 1, nextAttemptAt: 0 }); return { result: null, state }; });
      await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? first : second).update(partition, (state) => { state.updatedAt += 1; return { result: state.updatedAt, state }; })));
      await first.update(partition, (state) => { state.outbox[0].state = "inflight"; state.lease = { owner: "tab-one", until: Date.now() + 60000 }; return { result: null, state }; });
      const deniedClaim = await second.update(partition, (state) => {
        if (state.lease && state.lease.until > Date.now()) return { result: false, state };
        return { result: true, state };
      });
      if (deniedClaim) throw new Error("a second tab took a live IndexedDB lease");
      await first.update(partition, (state) => { state.lease.until = Date.now() - 1; return { result: null, state }; });
      const recovered = await second.update(partition, (state) => {
        if (state.lease && state.lease.until > Date.now()) return { result: false, state };
        for (const entry of state.outbox) if (entry.state === "inflight") entry.state = "queued";
        state.lease = { owner: "tab-two", until: Date.now() + 60000 };
        return { result: state.outbox[0].state === "queued", state };
      });
      if (!recovered) throw new Error("an expired lease did not recover its in-flight operation");
      const saved = await second.read(partition);
      if (saved.outbox.length !== 1 || saved.outbox[0].mutation.operation_id !== "stable-operation") throw new Error("outbox was lost during concurrent IDB updates");
      const isolated = await first.read({ accountId: "account-2", campaignId: "campaign-1", deviceId: "device-1" });
      if (isolated.outbox.length !== 0) throw new Error("account partition leaked");
      window.__indexedDbCheck = { savedCount: saved.outbox.length, updateCount: saved.updatedAt, partitionCount: await first.read(partition) };
    }, dbName);
    await page.reload();
    const persisted = await page.evaluate(async (name) => {
      const store = new window.mobileSyncModule.IndexedDbSyncStore(name);
      const state = await store.read({ accountId: "account-1", campaignId: "campaign-1", deviceId: "device-1" });
      const deviceId = await store.getOrCreateDeviceId("account-1");
      await store.clearAccount("account-1");
      const cleared = await store.read({ accountId: "account-1", campaignId: "campaign-1", deviceId: "device-1" });
      const resetDeviceId = await store.getOrCreateDeviceId("account-1");
      return { schema: state.schema, operationId: state.outbox[0]?.mutation.operation_id, leaseOwner: state.lease?.owner, afterClear: cleared.outbox.length, deviceId, resetDeviceId };
    }, dbName);
    assert.equal(persisted.schema, "rpg-nexus-mobile-v1"); assert.equal(persisted.operationId, "stable-operation"); assert.equal(persisted.leaseOwner, "tab-two"); assert.equal(persisted.afterClear, 0);
    assert.match(persisted.deviceId, /^[0-9a-f-]{36}$/i); assert.notEqual(persisted.deviceId, persisted.resetDeviceId);
    await page.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await browser.close();
  }
});

test("FastApiSyncTransport calls the browser's native fetch without Illegal invocation", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright) { t.skip("Playwright is not installed in this environment"); return; }
  let browser;
  try { browser = await playwright.chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message}`); return; }
  const ts = require("typescript");
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
  const mergeJs = ts.transpileModule(await readFile(mergePath, "utf8"), { compilerOptions }).outputText;
  const transportJs = ts.transpileModule(await readFile(transportPath, "utf8"), { compilerOptions }).outputText;
  const html = `<!doctype html><meta charset="utf-8"><script>(()=>{
    const mergeModule={exports:{}}; new Function('module','exports',${JSON.stringify(mergeJs)})(mergeModule,mergeModule.exports);
    const transportModule={exports:{}}; new Function('module','exports','require',${JSON.stringify(transportJs)})(transportModule,transportModule.exports,()=>mergeModule.exports);
    window.FastApiSyncTransport=transportModule.exports.FastApiSyncTransport; window.transportExportKeys=Object.keys(transportModule.exports);
  })()</script>`;
  const seen = [];
  const campaignId = "00000000-0000-4000-8000-000000000001";
  const ownerId = "00000000-0000-4000-8000-000000000002";
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html); return; }
    seen.push({ url: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ protocol_version: 1, campaigns: [{ id: campaignId, owner_id: ownerId, name: "Campanha Chromium" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const moduleCheck = await page.evaluate(() => ({ keys: window.transportExportKeys, type: typeof window.FastApiSyncTransport }));
    assert.deepEqual(moduleCheck, { keys: ["SyncHttpError", "FastApiSyncTransport", "parseRetryAfter", "checkedBaseUrl"], type: "function" });
    const result = await page.evaluate(async (baseUrl) => {
      const transport = new window.FastApiSyncTransport({ baseUrl, getAccessToken: async () => "test-access-token" });
      return await transport.listCampaigns();
    }, `http://127.0.0.1:${address.port}`);
    assert.equal(result[0].id, campaignId);
    assert.deepEqual(seen, [{ url: "/api/v1/sync/campaigns", authorization: "Bearer test-access-token" }]);
    await page.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await browser.close();
  }
});
