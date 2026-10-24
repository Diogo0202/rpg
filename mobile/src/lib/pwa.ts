/** A content-free client shell can serve these public app navigations offline. */
export const SHELL_ROUTES = [
  "/",
  "/fichas",
  "/fichas/nova",
  "/dados",
  "/mundo",
  "/mais",
  "/mais/diario",
  "/sincronizacao",
] as const;

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
