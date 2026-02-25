// Bump this version on each deploy to make cache invalidation explicit and traceable.
const CACHE_NAME = "car-record-book-v28";
const ASSETS = [
  "./",
  "./index.html",
  "./tailwind.local.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Do not cache or intercept external API/domain requests.
  if (!isSameOrigin) return;

  // Prefer fresh HTML for navigations so UI updates are not stuck on old cache.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", cloned));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  const destination = event.request.destination;
  const isStaticDestination =
    destination === "script" || destination === "style" || destination === "image" || destination === "font";
  const isManifestRequest = url.pathname.endsWith("/manifest.json") || url.pathname.endsWith("manifest.json");
  if (!isStaticDestination && !isManifestRequest) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response || !response.ok) return response;
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return new Response("Offline", { status: 504, statusText: "Offline" });
        }),
      ),
  );
});
