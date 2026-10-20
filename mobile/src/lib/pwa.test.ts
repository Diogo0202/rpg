import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicShellRequest, SHELL_ROUTES } from "./pwa";

const origin = "https://nexus.example";

function matches(path: string, options: { mode?: RequestMode; warmup?: boolean } = {}) {
  vi.stubGlobal("self", { location: { origin } });
  const headers = new Headers(options.warmup ? { "x-rpg-nexus-shell": "1" } : undefined);
  const request = { mode: options.mode ?? "navigate", headers } as Request;
  return isPublicShellRequest({ url: new URL(path, origin), request });
}

afterEach(() => vi.unstubAllGlobals());

describe("public shell cache matcher", () => {
  it("accepts only same-origin navigations on the shell route list", () => {
    expect(matches("/fichas")).toBe(true);
    expect(matches("/mais/musica")).toBe(false);
    expect(matches("/api/v1/sync")).toBe(false);
    expect(matches("/auth/callback")).toBe(false);
  });

  it("rejects other origins and query strings that may carry private values", () => {
    expect(matches("https://attacker.example/fichas")).toBe(false);
    expect(matches("/fichas?token=secret")).toBe(false);
    expect(matches("/fichas?character=private-id")).toBe(false);
  });

  it("permits explicit same-origin warmups only for actual shell URLs", () => {
    expect(matches("/mais/diario", { mode: "cors", warmup: true })).toBe(true);
    expect(matches("/mais/biblioteca", { mode: "cors", warmup: true })).toBe(false);
    expect(matches("https://attacker.example/fichas", { mode: "cors", warmup: true })).toBe(false);
    expect(matches("/fichas?code=secret", { mode: "cors", warmup: true })).toBe(false);
  });

  it("warms only the paths published as public shell URLs", () => {
    expect(SHELL_ROUTES).toEqual([
      "/",
      "/fichas",
      "/fichas/nova",
      "/dados",
      "/mundo",
      "/mais",
      "/mais/diario",
      "/sincronizacao",
    ]);
  });
});
