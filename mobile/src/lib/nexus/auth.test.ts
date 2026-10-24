import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FastApiSyncTransport } from "@/lib/mobile-sync/transport.ts";
import { accessTokenProvider, getSupabaseAuth, getSupabaseConfigProblem, resetSupabaseAuthForTests } from "./auth";

const sdk = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));

describe("Supabase auth adapter", () => {
  beforeEach(() => { resetSupabaseAuthForTests(); sdk.createClient.mockReset(); });

  it("returns current and refreshed SDK access tokens without writing them to app storage", async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "short-lived-token", user: { id: "alice" } } }, error: null });
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "refreshed-token", user: { id: "alice" } } }, error: null });
    const provider = accessTokenProvider({ auth: { getSession, refreshSession } } as unknown as Pick<SupabaseClient, "auth">, "alice");
    await expect(provider()).resolves.toBe("short-lived-token");
    await expect(provider(true)).resolves.toBe("refreshed-token");
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("blocks Alice's queued campaign request after the SDK session changes to Bob", async () => {
    const alice = { access_token: "alice-token", user: { id: "alice" } };
    const bob = { access_token: "bob-token", user: { id: "bob" } };
    const getSession = vi.fn().mockResolvedValue({ data: { session: alice }, error: null });
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: bob }, error: null });
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const transport = new FastApiSyncTransport({
      baseUrl: "http://localhost:8000",
      getAccessToken: accessTokenProvider({ auth: { getSession, refreshSession } } as unknown as Pick<SupabaseClient, "auth">, "alice"),
      fetch: fetcher,
      maxAttempts: 2,
      sleep: async () => undefined,
    });

    await expect(transport.push("11111111-1111-4111-8111-111111111111", {
      protocol_version: 1,
      device_id: "22222222-2222-4222-8222-222222222222",
      mutations: [{
        operation_id: "33333333-3333-4333-8333-333333333333",
        entity_type: "campaign_sessions",
        entity_id: "44444444-4444-4444-8444-444444444444",
        action: "create",
        base_version: 0,
        changes: [{ path: ["title"], before: { exists: false }, after: { exists: true, value: "Alice draft" } }],
        depends_on: [],
      }],
    })).rejects.toMatchObject({ status: 401 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer alice-token" });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("allows token refresh for the same bound account", async () => {
    const alice = { access_token: "alice-token", user: { id: "alice" } };
    const refreshedAlice = { access_token: "alice-refreshed-token", user: { id: "alice" } };
    const getSession = vi.fn().mockResolvedValue({ data: { session: alice }, error: null });
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: refreshedAlice }, error: null });
    const campaignId = "11111111-1111-4111-8111-111111111111";
    const operationId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        protocol_version: 1,
        campaign_id: campaignId,
        results: [{ operation_id: operationId, status: "applied" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const transport = new FastApiSyncTransport({
      baseUrl: "http://localhost:8000",
      getAccessToken: accessTokenProvider({ auth: { getSession, refreshSession } } as unknown as Pick<SupabaseClient, "auth">, "alice"),
      fetch: fetcher,
      maxAttempts: 2,
      sleep: async () => undefined,
    });

    const result = await transport.push(campaignId, {
      protocol_version: 1,
      device_id: "22222222-2222-4222-8222-222222222222",
      mutations: [{
        operation_id: operationId,
        entity_type: "campaign_sessions",
        entity_id: "44444444-4444-4444-8444-444444444444",
        action: "create",
        base_version: 0,
        changes: [{ path: ["title"], before: { exists: false }, after: { exists: true, value: "Alice draft" } }],
        depends_on: [],
      }],
    });

    expect(result.results[0]?.status).toBe("applied");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer alice-refreshed-token" });
  });

  it("rejects unsafe or service-role configuration before constructing the SDK", () => {
    expect(getSupabaseAuth({ VITE_SUPABASE_URL: "http://example.com", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo" })).toBeNull();
    expect(getSupabaseConfigProblem()).toMatch(/HTTPS/);
    resetSupabaseAuthForTests();
    expect(getSupabaseAuth({ VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_use" })).toBeNull();
    expect(getSupabaseConfigProblem()).toMatch(/chave secreta/);
    expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it("creates a persistent auth SDK client only from a safe URL and publishable key", () => {
    const client = { auth: {} };
    sdk.createClient.mockReturnValue(client);
    expect(getSupabaseAuth({ VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo" })).toBe(client);
    expect(sdk.createClient).toHaveBeenCalledWith("https://project.supabase.co", "sb_publishable_demo", {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  });
});
