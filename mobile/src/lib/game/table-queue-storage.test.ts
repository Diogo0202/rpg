import { beforeEach, describe, expect, it, vi } from "vitest";
const data = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/nexus/prefs", () => ({
  prefGet: async (key: string) => data.get(key),
  prefUpdateKeys: async (keys: string[], update: (values: unknown[]) => { result: unknown; writes: Array<[string, unknown]> }) => {
    const next = update(keys.map((key) => data.get(key)));
    for (const [key, value] of next.writes) data.set(key, value);
    return next.result;
  },
  prefSet: async (key: string, value: unknown) => { data.set(key, value); },
  prefDeletePrefix: async (prefix: string) => { for (const key of data.keys()) if (key.startsWith(prefix)) data.delete(key); },
}));
import { tableQueueFor, tableQueueKey, blockTableCampaign, restoreTableCampaign, clearTableAccount } from "./table-queue-storage";
import { makeQueuedAction } from "./action-queue";
const action = makeQueuedAction({ sheetId: "22222222-2222-4222-8222-222222222222", operationId: "33333333-3333-4333-8333-333333333333", path: "/api/v1/test", label: "test", body: {}, now: 1 });
beforeEach(() => data.clear());
describe("table queue storage", () => {
  it("partitions campaign and device and clears only the account", async () => {
    await tableQueueFor("a", "c", "d1").enqueue(action);
    expect(await tableQueueFor("a", "c", "d2").list()).toEqual([]);
    expect(await tableQueueFor("a", "other", "d1").list()).toEqual([]);
    await tableQueueFor("b", "c", "d1").enqueue(action);
    await clearTableAccount("a");
    expect(await tableQueueFor("b", "c", "d1").list()).toHaveLength(1);
    expect(data.has(tableQueueKey("a", "c", "d1"))).toBe(false);
  });
  it("migrates campaign legacy receipts once without changing operation ids", async () => {
    data.set("game-action-queue-v1:migrate:c", [action]);
    const queue = tableQueueFor("migrate", "c", "d");
    expect(await queue.list()).toEqual([action]);
    expect(await queue.list()).toEqual([action]);
    expect(data.get("game-action-queue-v1:migrate:c")).toEqual([]);
  });
  it("retains ambiguous account legacy data for explicit recovery", async () => {
    data.set("game-action-queue-v1:legacy", [action]);
    expect(await tableQueueFor("legacy", "c", "d").list()).toEqual([]);
    expect(data.get("game-action-queue-v1:legacy")).toEqual([action]);
  });
  it("persists revocation across reopening until authenticated access is restored", async () => {
    await blockTableCampaign("revoked", "c");
    await expect(tableQueueFor("revoked", "c", "new-device").enqueue(action)).rejects.toThrow("revogado");
    await restoreTableCampaign("revoked", "c");
    await expect(tableQueueFor("revoked", "c", "new-device").enqueue(action)).resolves.toHaveLength(1);
  });
});
