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

  function loadEnhancement(src) {
    const script = document.createElement("script");
    script.type = "module";
    script.src = src;
    document.head.appendChild(script);
  }

  const path = location.pathname.replace(/\/+$/, "");
  if (/\/amo(?:\.html)?$/.test(path)) {
    loadEnhancement(new URL("../../amo-procedure-enhancements.js?v=3", document.currentScript.src).href);
  }
  if (/\/asthma(?:\.html)?$/.test(path)) {
    loadEnhancement(new URL("../../asthma-enhancements.js?v=2", document.currentScript.src).href);
  }
  if (path.includes("/girn")) {
    loadEnhancement(new URL("../../girn/girn-enhancements.js?v=3", document.currentScript.src).href);
  }
})();
