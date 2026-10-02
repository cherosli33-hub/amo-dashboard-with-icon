import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { FIREBASE_CONFIG } from "../shared/firebase/config.js";
import { withTimeout } from "./loading.mjs";
import { readAccessProfile } from "./access.mjs";

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const gate = document.querySelector("#gate");
const dashboard = document.querySelector("#dashboard");
let dispose, generation = 0;
const started = performance.now();
const timing = {};
function message(title, detail, retry = false) {
  gate.hidden = false; dashboard.hidden = true;
  gate.replaceChildren();
  const h = document.createElement("h2"), p = document.createElement("p");
  h.textContent = title; p.textContent = detail; gate.append(h, p);
  if (retry) { const button = document.createElement("button"); button.textContent = "Cuba semula"; button.addEventListener("click", () => location.reload()); gate.append(button); }
  const link = document.createElement("a"); link.href = "../"; link.textContent = "Kembali ke dashboard utama"; gate.append(link);
}
// A direct authenticated document read avoids waiting on Firestore's live-data
// transport for a single access check. The same Security Rules still authorize it.

document.querySelector("#logoutBtn").addEventListener("click", async () => { generation++; dispose?.(); await signOut(auth); location.href = "../"; }, { once:true });
await withTimeout(auth.authStateReady(), 10000).then(() => {
  timing.authMs = Math.round(performance.now() - started);
  onAuthStateChanged(auth, async user => {
    const attempt = ++generation;
    dispose?.(); dispose = undefined;
    clearTimeout(window.amoAccessTimer);
    if (!user || user.isAnonymous) { message("Akses tidak dibenarkan", "Log masuk di dashboard utama menggunakan akaun admin atau penyelia yang diluluskan."); return; }
    message("Menyemak profil…", "Mengesahkan akses Admin / Penyelia.");
    const profileStart = performance.now();
    try {
      const profile = await readAccessProfile(user, FIREBASE_CONFIG.projectId);
      timing.profileMs = Math.round(performance.now() - profileStart);
      if (attempt !== generation) return;
      if (!profile?.active || !["admin", "supervisor"].includes(profile.role)) { message("Akses tidak dibenarkan", "Akaun ini belum diluluskan sebagai admin atau penyelia."); return; }
      message("Memuatkan dashboard…", "Akses diluluskan. Menyediakan paparan dan data hari ini.");
      const loadStart = performance.now();
      const [main] = await withTimeout(Promise.all([import("./app.js?v=13"), import("./activity-enhancement.js?v=2"), import("./procedure-shift-enhancement.js?v=2"), import("./findings-report-enhancement.js?v=1")]), 15000);
      if (attempt !== generation) return;
      // app.js must not register a second logout action after bootstrap owns it.
      dispose = main.mountDashboard(user, profile);
      timing.dashboardMs = Math.round(performance.now() - loadStart);
      timing.totalMs = Math.round(performance.now() - started);
      console.info("AMO startup timing (ms)", timing);
    } catch (error) {
      if (attempt !== generation) return;
      message("Dashboard belum dapat dibuka", error.name === "AbortError" ? "Semakan akses mengambil masa terlalu lama. Cuba semula." : error.message, true);
    }
  });
}).catch(error => { clearTimeout(window.amoAccessTimer); message("Sesi belum dapat disemak", error.message, true); });
