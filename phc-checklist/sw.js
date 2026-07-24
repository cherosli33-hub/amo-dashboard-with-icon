const CACHE = "phc-production-v18";
const ASSETS = ["./", "./index.html", "./inspection.html", "./records.html", "./settings.html", "./css/style.css", "./js/app.js", "./js/api.js", "./js/config.js", "./js/dashboard.js", "./js/inspection.js", "./js/records.js", "./js/settings.js", "./assets/logo.png", "./manifest.json"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  const url=new URL(event.request.url);
  const bypassHosts=["script.google.com","script.googleusercontent.com","docs.google.com"];
  if(url.origin!==self.location.origin||bypassHosts.includes(url.hostname)||["no-store","reload"].includes(event.request.cache)) return;
  const networkFirst=event.request.mode==="navigate"||["document","script","style"].includes(event.request.destination);
  if(networkFirst){
    const freshRequest=new Request(event.request,{cache:"no-store"});
    event.respondWith(fetch(freshRequest).then(response=>{ if(response.ok&&!response.redirected){ const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); } return response; }).catch(async()=>{
      const cached=await caches.match(event.request);
      if(cached) return cached;
      if(event.request.mode==="navigate") return caches.match("./index.html",{ignoreSearch:true});
      return Response.error();
    }));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{ if(response.ok&&!response.redirected){ const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); } return response; })));
});
