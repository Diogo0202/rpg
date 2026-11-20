import { describe, expect, it, vi } from "vitest";
import { GameApiError, createGameRequest, errorDetail, isRetryable, safeApiPath } from "./api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("game API client", () => {
  it("sends the bearer token and JSON body", async () => {
    const fetcher = vi.fn(async () => json(200, { ok: true }));
    const request = createGameRequest({ baseUrl: "https://api.example.test", getAccessToken: async () => "jwt", fetcher: fetcher as unknown as typeof fetch });
    await expect(request("POST", "/api/v1/hunter/rolls/x/reroll", { indices: [0] })).resolves.toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/hunter/rolls/x/reroll");
    expect(init.headers).toMatchObject({ Authorization: "Bearer jwt", "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ indices: [0] }));
  });

  it("refreshes the session once on 401", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(200, []));
    const tokens = vi.fn(async (refresh?: boolean) => (refresh ? "fresh" : "old"));
    const request = createGameRequest({ baseUrl: "https://api.example.test", getAccessToken: tokens, fetcher: fetcher as unknown as typeof fetch });
    await expect(request("GET", "/api/v1/v5/sheets/x/rolls")).resolves.toEqual([]);
    expect(tokens).toHaveBeenLastCalledWith(true);
  });

  it("maps server detail and network failures to statuses", async () => {
    const refuse = createGameRequest({ baseUrl: "https://api.example.test", getAccessToken: async () => "jwt", fetcher: (async () => json(409, { detail: "o caçador está em Desespero" })) as unknown as typeof fetch });
    await expect(refuse("POST", "/api/v1/hunter/sheets/x/rolls", {})).rejects.toMatchObject({ status: 409, message: "o caçador está em Desespero" });
    const offline = createGameRequest({ baseUrl: "https://api.example.test", getAccessToken: async () => "jwt", fetcher: (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch });
    const error = await offline("GET", "/api/v1/v5/sheets/x/blood").catch((caught) => caught);
    expect(error).toBeInstanceOf(GameApiError);
    expect(isRetryable(error)).toBe(true);
    expect(isRetryable(new GameApiError("x", 422))).toBe(false);
  });

  it("refuses insecure base URLs and foreign paths", () => {
    expect(() => createGameRequest({ baseUrl: "http://api.example.test", getAccessToken: async () => "jwt" })).toThrow("HTTPS");
    expect(() => safeApiPath("/api/v1/../admin")).toThrow();
    expect(() => safeApiPath("//evil.test/api/v1/x")).toThrow();
    expect(errorDetail({ detail: [{ msg: "a" }, { msg: "b" }] }, "x")).toBe("a b");
  });
});
