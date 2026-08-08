// AMO Core v1 — users.js
// Profil pengguna & peranan (role). Semua modul guna fail ini, bukan buat sendiri.

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./core.js";
import { COLLECTIONS } from "./database.js";

export const ROLES = Object.freeze({
  PENDING: "pending",
  SUPERVISOR: "supervisor",
  ADMIN: "admin"
});

// Baca profil pengguna dari koleksi users
export async function getProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

// Dipanggil selepas login. Kali pertama: cipta profil dengan role "ppp".
// Kali seterusnya: kemas kini lastLoginAt sahaja. TIDAK menimpa role sedia ada.
export async function ensureProfile(user) {
  if (!user?.uid) throw new Error("Pengguna tidak sah.");
  const ref = doc(db, COLLECTIONS.users, user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const profile = {
      email: user.email || "",
      name: user.displayName || "",
      role: ROLES.PENDING,
      active: false,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    };
    await setDoc(ref, profile);
    return { uid: user.uid, ...profile };
  }

  await setDoc(ref, { lastLoginAt: serverTimestamp() }, { merge: true });
  return { uid: user.uid, ...snap.data() };
}

export function hasRole(profile, ...roles) {
  return Boolean(profile?.active) && roles.includes(profile?.role);
}

export function isAdmin(profile) {
  return hasRole(profile, ROLES.ADMIN);
}

export function isSupervisor(profile) {
  return hasRole(profile, ROLES.SUPERVISOR, ROLES.ADMIN);
}

// Guard untuk halaman terhad. Throw kalau tiada kebenaran.
export async function requireRole(uid, ...roles) {
  const profile = await getProfile(uid);
  if (!hasRole(profile, ...roles)) {
    throw new Error("Anda tiada kebenaran untuk halaman ini.");
  }
  return profile;
}
