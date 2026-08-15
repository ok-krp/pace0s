const CACHE_NAME = "pace-runtime-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Keep navigation/resources network-first while providing the fetch handler
// required for a fully installable PWA. Pace remains server-rendered/network-backed.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});
