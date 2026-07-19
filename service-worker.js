const CACHE = "amo-etd-lepeh-v16-amo-main-menu";
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

const AMO_HEADER_CSS = `
<style id="amo-main-menu-header-style">
  .app-header{position:sticky;top:0;z-index:70;color:#fff;background:rgba(21,129,90,.97);backdrop-filter:blur(12px);box-shadow:0 5px 20px rgba(5,65,45,.14)}
  .app-header-inner{display:flex;align-items:center;gap:12px;max-width:720px;min-height:62px;margin:0 auto;padding:max(9px, env(safe-area-inset-top)) 16px 9px}
  .main-menu-link{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid rgba(255,255,255,.28);border-radius:12px;color:#fff;text-decoration:none;font-size:24px;line-height:1}
  .app-title{min-width:0}.app-title strong{display:block;font-family:'Space Grotesk',sans-serif;font-size:15px;line-height:1.15}.app-title small{display:block;margin-top:2px;color:#D8F6EA;font-size:12px}
  .app-mark{width:40px;height:40px;margin-left:auto;border-radius:11px;background:#fff}
</style>`;

const AMO_HEADER_HTML = `
<header class="app-header">
  <div class="app-header-inner">
    <a class="main-menu-link" href="./" aria-label="Kembali ke menu utama">‹</a>
    <div class="app-title"><strong>Dashboard Log Prosedur A.M.O</strong><small>ETD Lepeh</small></div>
    <img class="app-mark" src="./icon-192.png?v=4" alt="">
  </div>
</header>`;

function isAmoPage(request){
  const url = new URL(request.url);
  return url.origin === self.location.origin && /\/amo\.html$/.test(url.pathname);
}

async function withAmoHeader(response){
  const type = response.headers.get("content-type") || "";
  if(!type.includes("text/html")) return response;
  let html = await response.text();
  if(html.includes("main-menu-link") || html.includes("amo-main-menu-header-style")){
    return new Response(html, response);
  }
  html = html.replace("</head>", `${AMO_HEADER_CSS}\n</head>`).replace("<body>", `<body>\n${AMO_HEADER_HTML}`);
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(async response => {
    const finalResponse = isAmoPage(event.request) ? await withAmoHeader(response) : response;
    const copy = finalResponse.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return finalResponse;
  }).catch(() => caches.match(event.request).then(async response => {
    const fallback = response || await caches.match("./index.html");
    return fallback && isAmoPage(event.request) ? withAmoHeader(fallback) : fallback;
  })));
});
