const CACHE = "amo-etd-lepeh-v14-amo-migration";
const ASSETS = [
  "./",
  "./index.html",
  "./asthma.html",
  "./amo.html",
  "./amo-config.js",
  "./styles.css?v=5",
  "./config.js?v=7",
  "./pefr.mjs",
  "./asthma.mjs?v=11",
  "./manifest.json?v=4",
  "./icon-192.png?v=4",
  "./icon-512.png?v=4",
  "./apple-touch-icon.png?v=4",
  "./favicon.png?v=4",
  "./references/adult-pefr-chart.jpeg",
  "./references/paediatric-pefr-table.jpeg",
  "./references/pefr-interpretation.jpeg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match("./index.html"))));
});
