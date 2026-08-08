import {
  GoogleAuthProvider,
  browserLocalPersistence,
  linkWithPopup,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./core.js";

const googleProvider = new GoogleAuthProvider();

export async function prepareAuth() {
  await setPersistence(auth, browserLocalPersistence);
  return auth;
}

export async function ensureAppSession() {
  await prepareAuth();
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth.currentUser;
}

export async function loginGoogle() {
  await prepareAuth();
  const result = auth.currentUser?.isAnonymous
    ? await linkWithPopup(auth.currentUser, googleProvider).catch(error => {
        if (["auth/credential-already-in-use", "auth/email-already-in-use"].includes(error.code)) {
          return signInWithPopup(auth, googleProvider);
        }
        throw error;
      })
    : await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}
