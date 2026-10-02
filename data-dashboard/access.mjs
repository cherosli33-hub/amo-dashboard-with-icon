import { withTimeout } from "./loading.mjs";

export async function readAccessProfile(user, projectId, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await withTimeout(user.getIdToken(), timeoutMs);
    const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}`, { headers:{ Authorization:`Bearer ${token}` }, signal:controller.signal, cache:"no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(response.status === 403 ? "Profil pengguna tidak dapat dibaca." : "Sambungan semakan akses gagal.");
    const { fields = {} } = await response.json();
    return { uid:user.uid, name:fields.name?.stringValue || "", email:fields.email?.stringValue || "", role:fields.role?.stringValue || "", active:fields.active?.booleanValue === true };
  } finally { clearTimeout(timer); }
}
