// Hybrid Training service worker.
// Strategy:
//  - App shell + Next.js chunks: stale-while-revalidate
//  - /api/movements/search: stale-while-revalidate (movement catalog rarely changes)
//  - /app/* navigations: network-first with a short timeout so the offline
//    shell only shows when the network is truly down
//  - Everything else: network only

const VERSION = "hta-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll([
        "/manifest.webmanifest",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
      ]),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App routes: network-first with a 3s timeout fallback to cache.
  if (url.pathname.startsWith("/app") || url.pathname === "/") {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, 3000));
    return;
  }

  // Static assets + manifest + icons + Next.js chunks: stale-while-revalidate.
  if (
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Movement catalog: cache so the gym log works offline.
  if (url.pathname.startsWith("/api/movements/search")) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Default: pass through.
});

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      ),
    ]);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}
