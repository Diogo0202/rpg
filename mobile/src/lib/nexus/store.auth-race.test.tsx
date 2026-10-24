import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NexusProvider, useNexus } from "./store";

const harness = vi.hoisted(() => {
  let resolveAliceDevice: ((value: string) => void) | undefined;
  const aliceDevice = new Promise<string>((resolve) => { resolveAliceDevice = resolve; });
  const authCallback = { current: null as ((event: string, session: { user: { id: string; email?: string } } | null) => void) | null };
  const campaigns = [{
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Campanha Alice",
    description: null,
  }];
  const caps = {
    protocol_version: 1,
    campaign_id: campaigns[0]!.id,
    role: "owner",
    entity_fields: { campaign_sessions: ["title"] },
  };
  const states: Record<string, { schema: "rpg-nexus-mobile-v1"; partition: { accountId: string; campaignId: string; deviceId: string }; cursor: string | null; records: Record<string, never>; outbox: { mutation: { operation_id: string } }[]; updatedAt: number }> = {};
  const store = {
    getOrCreateDeviceId: vi.fn((accountId: string) => accountId === "alice" ? aliceDevice : Promise.resolve("local-device")),
    clearAccount: vi.fn(async () => undefined),
  };
  const constructedPartitions: { accountId: string; campaignId: string; deviceId: string }[] = [];
  const authClient = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "alice", email: "alice@example.test" } } }, error: null })),
      refreshSession: vi.fn(),
      onAuthStateChange: vi.fn((callback: typeof authCallback.current) => {
        authCallback.current = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  };
  return {
    authCallback,
    authClient,
    campaigns,
    caps,
    constructedPartitions,
    states,
    store,
    resolveAliceDevice: (value: string) => resolveAliceDevice?.(value),
  };
});

vi.mock("@/lib/nexus/auth", () => ({
  accessTokenProvider: () => async () => "account-bound-token",
  getSupabaseAuth: () => harness.authClient,
  getSupabaseConfigProblem: () => null,
}));

vi.mock("@/lib/nexus/prefs", () => ({
  prefGet: async (key: string) => {
    if (key.startsWith("nexus-cached-campaigns-v1:alice")) return harness.campaigns;
    if (key.startsWith("nexus-selected-campaign-v1:alice")) return harness.campaigns[0]!.id;
    if (key.startsWith("nexus-cached-capabilities-v1:alice:")) return harness.caps;
    return undefined;
  },
  prefSet: async () => undefined,
}));

vi.mock("@/lib/nexus/seed", () => ({ seedDemo: vi.fn(async () => undefined) }));

vi.mock("@/lib/mobile-sync/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-sync/index.ts")>();
  class FakeSyncEngine {
    readonly partition: { accountId: string; campaignId: string; deviceId: string };
    constructor(config: { accountId: string; campaignId: string; deviceId: string }, _store: unknown, _transport: unknown) {
      this.partition = config;
      harness.constructedPartitions.push(config);
    }
    async readState() {
      const key = `${this.partition.accountId}:${this.partition.campaignId}:${this.partition.deviceId}`;
      return harness.states[key] ?? {
        schema: "rpg-nexus-mobile-v1" as const,
        partition: this.partition,
        cursor: null,
        records: {},
        outbox: [],
        updatedAt: 1,
      };
    }
    async getRecord() { return undefined; }
  }
  class FakeTransport {
    constructor(_options: unknown) {}
    async capabilities(campaignId: string) { return { ...harness.caps, campaign_id: campaignId }; }
    async listCampaigns() { return harness.campaigns; }
  }
  class FakeSyncHttpError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
  return {
    ...actual,
    FastApiSyncTransport: FakeTransport,
    SyncEngine: FakeSyncEngine,
    SyncHttpError: FakeSyncHttpError,
    openSyncStore: () => harness.store,
    fieldValuesEqual: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
  };
});

function Probe() {
  const value = useNexus();
  return <output data-testid="provider-state">{`${value.accountId}|${value.mode}|${value.user?.id ?? "signed-out"}|${value.engine?.partition.accountId ?? "no-engine"}`}</output>;
}

describe("NexusProvider account session races", () => {
  it("does not reopen Alice's cached campaign when her deferred device lookup resolves after Bob signs in", async () => {
    const campaignId = harness.campaigns[0]!.id;
    harness.states[`alice:${campaignId}:alice-device`] = {
      schema: "rpg-nexus-mobile-v1",
      partition: { accountId: "alice", campaignId, deviceId: "alice-device" },
      cursor: "8",
      records: {},
      outbox: [{ mutation: { operation_id: "alice-pending-op" } }],
      updatedAt: 1,
    };

    render(<NexusProvider><Probe /></NexusProvider>);
    await waitFor(() => expect(harness.store.getOrCreateDeviceId).toHaveBeenCalledWith("alice"));
    expect(harness.authCallback.current).not.toBeNull();

    act(() => harness.authCallback.current?.("SIGNED_IN", { user: { id: "bob", email: "bob@example.test" } }));
    harness.resolveAliceDevice("alice-device");

    await waitFor(() => expect(screen.getByTestId("provider-state")).toHaveTextContent("local-demo|local|bob|local-demo"));
    expect(harness.constructedPartitions.map((partition) => partition.accountId)).toEqual(["local-demo"]);
    expect(harness.states[`alice:${campaignId}:alice-device`]?.outbox).toHaveLength(1);
    expect(harness.store.clearAccount).not.toHaveBeenCalled();
  });
});
