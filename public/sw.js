/* Only public fallback assets are cached. Never add authenticated HTML, RSC,
   API responses, media, map tiles, or tokens to this cache.
   Bump the cache version when changing the offline pages or icon assets. */
const CACHE_PREFIX = "curator-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_ASSETS = ["/offline.es.html", "/offline.en.html", "/icons/curator-192.png", "/icons/curator-512.png"];
const locale = new URL(self.location.href).searchParams.get("locale") === "en" ? "en" : "es";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(OFFLINE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(`/offline.${locale}.html`)) || Response.error();
    }
  })());
});
