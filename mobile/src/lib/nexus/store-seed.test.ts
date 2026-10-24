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
});
