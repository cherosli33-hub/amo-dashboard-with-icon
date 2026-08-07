import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./core.js";

export const COLLECTIONS = Object.freeze({
  users: "users",
  girn: "girn_records",
  girnFindings: "girn_findings",
  phc: "phc_records",
  asthma: "asthma_records",
  procedure: "procedure_records"
});

export function serverNow() {
  return serverTimestamp();
}

export async function saveById(collectionName, id, data, { merge = false } = {}) {
  if (!collectionName || !id) throw new Error("Collection dan ID diperlukan.");
  const ref = doc(db, collectionName, id);
  await setDoc(ref, data, { merge });
  return id;
}

export async function readById(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateById(collectionName, id, changes) {
  await updateDoc(doc(db, collectionName, id), changes);
}

export async function removeById(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
}

export async function latest(collectionName, { orderField = "savedAt", count = 100 } = {}) {
  const q = query(collection(db, collectionName), orderBy(orderField, "desc"), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function listWhere(collectionName, field, op, value, { count = 100 } = {}) {
  const q = query(collection(db, collectionName), where(field, op, value), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}
