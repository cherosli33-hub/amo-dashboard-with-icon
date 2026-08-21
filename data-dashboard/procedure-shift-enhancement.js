import { collection, onSnapshot, query, limit } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "../shared/firebase/core.js";
import { COLLECTIONS } from "../shared/firebase/database.js";

const TZ = "Asia/Kuala_Lumpur";
let procedureRows = [];
let frame = 0;

function localParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"
  }).formatToParts(date).map(part => [part.type, part.value]));
}

function dateKeyFromDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(date);
}

function previousDateKey(key) {
  const date = new Date(`${key}T12:00:00+08:00`);
  date.setDate(date.getDate() - 1);
  return dateKeyFromDate(date);
}

function rowClockHour(row) {
  const time = String(row.time || "").trim();
  const match = time.match(/^(\d{1,2}):/);
  if (match) return Number(match[1]);
  const raw = row.submittedAt || row.timestamp || row.savedAt || row.createdAt;
  const date = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone:TZ, hour:"2-digit", hourCycle:"h23" }).format(date));
}

function rowCalendarDate(row) {
  const rawDate = String(row.date || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) return rawDate.slice(0, 10);
  const raw = row.submittedAt || row.timestamp || row.savedAt || row.createdAt;
  const date = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? dateKeyFromDate(date) : "";
}

function operationalDate(row) {
  const date = rowCalendarDate(row);
  if (!date) return "";
  const shift = String(row.shift || "").trim().toLocaleLowerCase("ms-MY");
  const hour = rowClockHour(row);
  const isNight = shift.includes("malam") || shift.includes("night");
  return isNight && hour != null && hour < 7 ? previousDateKey(date) : date;
}

function currentOperationalDate() {
  const now = new Date();
  const parts = localParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < 7 ? previousDateKey(today) : today;
}

function currentShiftLabel() {
  const hour = Number(localParts().hour);
  if (hour >= 21 || hour < 7) return "Malam";
  if (hour >= 14) return "Petang";
  return "Pagi";
}

function patchProcedureCard() {
  const cards = document.querySelectorAll("#moduleCards .module-card");
  const card = [...cards].find(node => node.querySelector(".module-icon")?.textContent.trim() === "PR");
  if (!card) return;
  const count = procedureRows.filter(row => operationalDate(row) === currentOperationalDate()).length;
  const value = card.querySelector(".module-copy strong");
  const label = card.querySelector(".module-copy span");
  const note = card.querySelector(".module-copy em");
  if (value) value.textContent = String(count);
  if (label) label.textContent = "prosedur syif harian";
  if (note) note.textContent = "Hari operasi 07:00 – 06:59";
}

function patchHeaderShift() {
  const context = document.querySelector("#todayContext");
  if (!context) return;
  const text = context.textContent || "";
  if (!text.includes("Syif")) return;
  context.textContent = text.replace(/Syif\s+(Pagi|Petang|Malam)/, `Syif ${currentShiftLabel()}`);
}

function schedulePatch() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    patchProcedureCard();
    patchHeaderShift();
  });
}

const observer = new MutationObserver(schedulePatch);
observer.observe(document.body, { childList:true, subtree:true, characterData:true });

const stop = onSnapshot(query(collection(db, COLLECTIONS.procedure), limit(5000)), snapshot => {
  procedureRows = snapshot.docs.map(doc => ({ id:doc.id, ...doc.data() }));
  schedulePatch();
}, error => console.error("Gagal menyelaras kiraan syif Prosedur", error));

schedulePatch();
window.addEventListener("beforeunload", () => { observer.disconnect(); stop(); });
