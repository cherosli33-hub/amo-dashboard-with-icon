const CACHE = "amo-dashboard-legacy-closed-v1";
const CLOSED_PAGE = "./index.html";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(CLOSED_PAGE, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(new Request(CLOSED_PAGE, { cache: "no-store" })).catch(() => caches.match(CLOSED_PAGE)));
  }
});
