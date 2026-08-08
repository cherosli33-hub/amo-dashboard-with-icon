(function installAMOFirebaseBridge() {
  const nativeFetch = window.fetch.bind(window);
  const adapterUrl = new URL("./legacy-adapter.js", document.currentScript.src).href;
  window.__AMO_NATIVE_FETCH = nativeFetch;
  window.AMOFirebaseRequest = function (request) {
    return import(adapterUrl).then(module => module.firebaseRequest(request));
  };
  window.AMOSubscribe = function (moduleName, callback, onError) {
    let stop = null;
    let cancelled = false;
    import(adapterUrl).then(module => {
      if (cancelled) return;
      stop = module.subscribeModule(moduleName, callback, onError);
    }).catch(error => onError?.(error));
    return () => { cancelled = true; stop?.(); };
  };
  window.fetch = function (input, init) {
    const raw = typeof input === "string" ? input : input?.url || "";
    let hostname = "";
    try { hostname = new URL(raw, location.href).hostname; } catch { /* native fetch reports invalid URLs */ }
    if (hostname === "script.google.com" || hostname.endsWith(".googleusercontent.com")) {
      return import(adapterUrl).then(module => module.firebaseFetch(input, init));
    }
    return nativeFetch(input, init);
  };
  if (location.pathname.startsWith("/girn")) {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/girn/girn-enhancements.js?v=1";
    document.head.appendChild(script);
  }
})();
