// AMO Core v1 — utils.js
// Fungsi umum yang dikongsi semua modul. Jangan letak logik modul di sini.

export function newId(prefix = "rec") {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}_${r}`;
}

// "2026-08-07" — kunci harian untuk statistik
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString("ms-MY", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

export function formatDateTime(value) {
  const d = toDate(value);
  return d
    ? d.toLocaleString("ms-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}

// Terima Date, Firestore Timestamp, string ISO atau millis
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Bungkus operasi async supaya error seragam di semua modul
export async function safeRun(operation, { label = "operasi" } = {}) {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error(`[AMO] Gagal ${label}:`, error);
    return { ok: false, error: mesejRalat(error) };
  }
}

export function mesejRalat(error) {
  const code = error?.code || "";
  if (code.includes("permission-denied")) return "Anda tiada kebenaran untuk tindakan ini.";
  if (code.includes("unavailable") || code.includes("network")) return "Masalah rangkaian. Cuba semula.";
  if (code.includes("not-found")) return "Rekod tidak dijumpai.";
  return error?.message || "Ralat tidak diketahui.";
}
