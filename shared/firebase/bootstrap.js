(function installAMOFirebaseBridge() {
  const nativeFetch = window.fetch.bind(window);
  const adapterUrl = new URL("./legacy-adapter.js", document.currentScript.src).href;
  window.__AMO_NATIVE_FETCH = nativeFetch;
  window.AMOFirebaseRequest = function (request) {
    return import(adapterUrl).then(module => module.firebaseRequest(request));
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
})();
