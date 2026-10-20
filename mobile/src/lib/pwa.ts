/**
 * Single service-worker registration wrapper. Never registers in dev, iframes,
 * Lovable preview hosts or with ?sw=off; in those contexts it unregisters /sw.js.
 */
export const SHELL_ROUTES = [
  "/",
  "/fichas",
  "/fichas/nova",
  "/dados",
  "/mundo",
  "/mais",
  "/mais/diario",
  "/sincronizacao",
];

/** Workbox-serializable matcher: keep it self-contained for generateSW. */
export function isPublicShellRequest({ url, request }: { url: URL; request: Request }): boolean {
  const routes = [
    "/",
    "/fichas",
    "/fichas/nova",
    "/dados",
    "/mundo",
    "/mais",
    "/mais/diario",
    "/sincronizacao",
  ];
  const isWarmup = request.headers.get("x-rpg-nexus-shell") === "1";
  return (
    url.origin === self.location.origin &&
    url.search === "" &&
    routes.includes(url.pathname) &&
    (request.mode === "navigate" || isWarmup)
  );
}

function refused(): boolean {
  if (!import.meta.env.PROD) return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  for (const d of ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"])
    if (h === d || h.endsWith(`.${d}`)) return true;
  return new URLSearchParams(window.location.search).get("sw") === "off";
}

async function unregisterAppWorkers() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter(
        (r) =>
          r.active?.scriptURL.endsWith("/sw.js") ||
          r.installing?.scriptURL.endsWith("/sw.js") ||
          r.waiting?.scriptURL.endsWith("/sw.js"),
      )
      .map((r) => r.unregister()),
  );
}

export type PwaStatus = "unsupported" | "disabled-here" | "registered" | "error";

export async function setupServiceWorker(): Promise<PwaStatus> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  if (refused()) {
    await unregisterAppWorkers().catch(() => undefined);
    return "disabled-here";
  }
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const reg = await navigator.serviceWorker.ready;
    // Warm the shell cache for every tab so offline navigation works. Shell HTML has no private data.
    if (reg.active)
      for (const path of SHELL_ROUTES)
        void fetch(path, {
          headers: { "x-rpg-nexus-shell": "1" },
          credentials: "omit",
        }).catch(() => undefined);
    return "registered";
  } catch {
    return "error";
  }
}

/** Clears only this app's shell caches (used on logout/local wipe). */
export async function clearShellCaches() {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("rpg-nexus-")).map((k) => caches.delete(k)));
}
