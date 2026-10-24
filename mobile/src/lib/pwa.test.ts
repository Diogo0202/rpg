// @vitest-environment node
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PWA_WORKBOX_OPTIONS, pwaWorkerOptions, generatePwaWorker } from "../../pwa-build";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SHELL_ROUTES } from "./pwa";

describe("offline SPA shell", () => {
  it("changes the generated shell revision between releases and excludes private documents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-pwa-release-"));
    try {
      const publicDirectory = join(directory, "public");
      const clientDirectory = join(directory, "client");
      await mkdir(publicDirectory);
      await mkdir(clientDirectory);
      await mkdir(join(publicDirectory, "assets"));
      await mkdir(join(publicDirectory, "api"));
      await mkdir(join(publicDirectory, "fichas"));
      await writeFile(join(publicDirectory, "assets", "app-release.js"), "console.log('app');");
      await writeFile(join(publicDirectory, "api", "private.html"), "private API fixture");
      await writeFile(join(publicDirectory, "fichas", "index.html"), "private SSR fixture");
      await writeFile(join(publicDirectory, "account.json"), JSON.stringify({ fixture: true }));

      const oldShell =
        '<html><script src="/assets/app-release.js"></script><title>Old release</title></html>';
      const newShell = oldShell.replace("Old release", "New release");
      const digest = (value: string) => createHash("md5").update(value).digest("hex");
      await writeFile(join(clientDirectory, "_shell.html"), oldShell);
      await generatePwaWorker(publicDirectory, clientDirectory);
      const oldWorker = await readFile(join(publicDirectory, "sw.js"), "utf8");
      expect(oldWorker).toContain(digest(oldShell));
      expect(await readFile(join(publicDirectory, "_shell.html"), "utf8")).toBe(oldShell);

      await writeFile(join(clientDirectory, "_shell.html"), newShell);
      await generatePwaWorker(publicDirectory, clientDirectory);
      const newWorker = await readFile(join(publicDirectory, "sw.js"), "utf8");
      expect(newWorker).toContain(digest(newShell));
      expect(newWorker).not.toContain(digest(oldShell));
      expect(await readFile(join(publicDirectory, "_shell.html"), "utf8")).toBe(newShell);
      expect(newWorker).not.toContain("account.json");
      expect(newWorker).not.toContain("private.html");
      expect(newWorker).not.toContain("fichas/index.html");
    } finally {
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith("atlas-pwa-release-")
      ) {
        throw new Error("Unexpected PWA test cleanup directory.");
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);

  it("uses TanStack's revisioned content-free shell, not an SSR route document", () => {
    expect(PWA_WORKBOX_OPTIONS.navigateFallback).toBe("/_shell.html");
    expect(PWA_WORKBOX_OPTIONS.globPatterns).toContain("_shell.html");
    expect(PWA_WORKBOX_OPTIONS.globPatterns).not.toContain("**/*.html");
    expect("additionalManifestEntries" in PWA_WORKBOX_OPTIONS).toBe(false);
    expect(pwaWorkerOptions("/build/public", "/build/public/sw.js").globDirectory).toBe(
      "/build/public",
    );
    expect(PWA_WORKBOX_OPTIONS.globIgnores).toEqual(
      expect.arrayContaining(["**/api/**", "**/auth/**"]),
    );
  });

  it("supports public app routes with local query state without caching the query", () => {
    const [allowlist] = PWA_WORKBOX_OPTIONS.navigateFallbackAllowlist;
    expect(allowlist.test("/fichas?ficha=123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(allowlist.test("/fichas/nova")).toBe(true);
    expect(allowlist.test("/mais/musica")).toBe(false);
    expect(allowlist.test("/api/v1/sync")).toBe(false);
    expect(
      PWA_WORKBOX_OPTIONS.navigateFallbackDenylist.some((rule) => rule.test("/auth/callback")),
    ).toBe(true);
  });

  it("includes only the known public shell paths for navigation fallback", () => {
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
