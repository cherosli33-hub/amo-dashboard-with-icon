window.AMO_CONFIG = Object.freeze({
  // Marker URL intercepted by shared/firebase/bootstrap.js. It is deliberately
  // not a live Apps Script deployment, so a bridge failure cannot write to production.
  apiUrl: "https://script.google.com/macros/s/firebase-v2-procedure/exec",
  writeEnabled: true,
  environment: "firebase-v2"
});
