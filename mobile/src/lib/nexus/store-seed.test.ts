import { describe, expect, it } from "vitest";
import { MemoryCoordinator, MemorySyncStore, SyncEngine } from "@/lib/mobile-sync/index.ts";
import { seedLocalDemoOnce } from "./store";
import { LOCAL_ACCOUNT_ID, LOCAL_CAMPAIGN_ID, LOCAL_ENTITY_FIELDS, LocalOnlyTransport } from "./config";

const device = "00000000-0000-4000-8000-000000000001";

describe("local demo startup", () => {
  it("seeds once when two provider initializations race on the same partition", async () => {
    const store = new MemorySyncStore(new MemoryCoordinator());
    const makeEngine = () => new SyncEngine({ accountId: LOCAL_ACCOUNT_ID, campaignId: LOCAL_CAMPAIGN_ID, deviceId: device, entityFields: LOCAL_ENTITY_FIELDS }, store, new LocalOnlyTransport());
    const first = makeEngine(), second = makeEngine();
    await Promise.all([seedLocalDemoOnce(first), seedLocalDemoOnce(second)]);
    const state = await first.readState();
    expect(state.outbox).toHaveLength(6);
    expect(state.outbox.filter((entry) => entry.mutation.action === "create")).toHaveLength(6);
  });
  it("keeps large portraits in the local partition across reopen and removal", async () => {
    const store = new MemorySyncStore(new MemoryCoordinator());
    const config = { accountId: LOCAL_ACCOUNT_ID, campaignId: LOCAL_CAMPAIGN_ID, deviceId: device, entityFields: LOCAL_ENTITY_FIELDS, localOnly: true };
    const first = new SyncEngine(config, store, new LocalOnlyTransport());
    const webp = atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
    const original = Uint8Array.from(webp, (letter) => letter.charCodeAt(0));
    const bytes = new Uint8Array(original.length + 40008);
    bytes.set(original);
    bytes.set([74, 85, 78, 75], original.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, bytes.length - 8, true);
    view.setUint32(original.length + 4, 40000, true);
    const portrait = "data:image/webp;base64," + btoa(String.fromCharCode(...bytes));

    const schema = { name: "Modelo próprio", version: 1, fields: [{ id: "nome", label: "Nome", kind: "text" }] };
    const created = await first.enqueue({ entityType: "character_sheets", action: "create", changes: [
      { path: ["name"], before: { exists: false }, after: { exists: true, value: "Lia" } },
      { path: ["portrait_data"], before: { exists: false }, after: { exists: true, value: portrait } },
      { path: ["template_schema"], before: { exists: false }, after: { exists: true, value: schema } },
    ] });
    const reopened = new SyncEngine(config, store, new LocalOnlyTransport());
    expect((await reopened.getRecord("character_sheets", created.entity_id))?.data.portrait_data).toBe(portrait);
    expect((await reopened.getRecord("character_sheets", created.entity_id))?.data.template_schema).toEqual(schema);
    await reopened.enqueue({ entityType: "character_sheets", entityId: created.entity_id, action: "update", changes: [
      { path: ["portrait_data"], before: { exists: true, value: portrait }, after: { exists: true, value: null } },
    ] });
    expect((await reopened.getRecord("character_sheets", created.entity_id))?.data.portrait_data).toBeNull();
  });
});
