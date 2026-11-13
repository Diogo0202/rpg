const CACHE = "one-ring-public-shell-v3";
const SHELL = "/offline/one-ring";
async function prewarm() {
  const cache = await caches.open(CACHE);
  const response = await fetch(SHELL, { credentials: "omit", cache: "reload", headers: { Accept: "text/html" } });
  if (!response.ok || response.redirected || new URL(response.url).pathname !== SHELL || !response.headers.get("content-type")?.includes("text/html")) throw new Error("Shell offline indisponível.");
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)].map((match) => match[1].replaceAll("&amp;", "&"));
  await Promise.all([...new Set(assets)].map(async (asset) => {
    const result = await fetch(asset, { credentials: "omit", cache: "reload" });
    if (!result.ok) throw new Error("Recurso offline indisponível.");
    await cache.put(asset, result);
  }));
  await cache.put(SHELL, response);
}
self.addEventListener("install", (event) => { event.waitUntil(prewarm().then(() => self.skipWaiting())); });
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("one-ring-public-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => { if (event.data?.type === "PREWARM_ONE_RING") event.waitUntil(prewarm()); });
self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || request.headers.has("RSC") || request.headers.has("Next-Router-Prefetch") || url.searchParams.has("_rsc")) return;
  if (request.mode === "navigate" && (url.pathname === SHELL || url.pathname === `${SHELL}/`)) {
    // Cache only the public shell fetched without cookies, never a navigation response.
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(SHELL)) ?? fetch(SHELL, { credentials: "omit", headers: { Accept: "text/html" } })));
  } else if (url.pathname.startsWith("/_next/static/") && ["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request); if (hit) return hit;
      const response = await fetch(request, { credentials: "omit" });
      if (response.ok && response.type === "basic" && !response.redirected) await cache.put(request, response.clone());
      return response;
    }));
  }
});
