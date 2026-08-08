import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./core.js";
import { loginGoogle, logout, prepareAuth } from "./auth.js";
import { ensureProfile, getProfile, isSupervisor } from "./users.js";

const loginButton = document.querySelector("#loginBtn");
const logoutButton = document.querySelector("#logoutBtn");
const dashboardLink = document.querySelector("#dataDashboardLink");
const message = document.querySelector("#authMessage");

function render(user, profile) {
  const signedIn = Boolean(user && !user.isAnonymous);
  loginButton.hidden = signedIn;
  logoutButton.hidden = !signedIn;
  dashboardLink.hidden = !isSupervisor(profile);
  if (!signedIn) message.textContent = "Log masuk Google sekali untuk dashboard data dan semakan penyelia.";
  else if (isSupervisor(profile)) message.textContent = `${profile.name || user.displayName || user.email} · sesi kekal aktif sehingga Log keluar.`;
  else message.textContent = `${user.email} telah log masuk tetapi akses masih menunggu kelulusan admin.`;
}

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  message.textContent = "Membuka log masuk Google…";
  try {
    const user = await loginGoogle();
    const profile = await ensureProfile(user);
    render(user, profile);
  } catch (error) {
    message.textContent = error.message || "Log masuk tidak berjaya.";
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await logout();
  render(null, null);
});

await prepareAuth();
onAuthStateChanged(auth, async user => {
  const profile = user && !user.isAnonymous ? await getProfile(user.uid).catch(() => null) : null;
  render(user, profile);
});
