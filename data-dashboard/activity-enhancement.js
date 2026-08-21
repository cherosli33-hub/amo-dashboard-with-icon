import { collection, limit, onSnapshot, query } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "../shared/firebase/core.js";
import { COLLECTIONS } from "../shared/firebase/database.js";

const TZ = "Asia/Kuala_Lumpur";
const moduleLinks = { procedure:"../amo.html", asthma:"../asthma.html", phc:"../phc-checklist/", girn:"../girn/" };
const moduleLabels = { procedure:"Prosedur", asthma:"Asthma", phc:"PHC", girn:"GIRN" };
const moduleCollections = {
  procedure:COLLECTIONS.procedure,
  asthma:COLLECTIONS.asthma,
  phc:COLLECTIONS.phc,
  girn:COLLECTIONS.girn
};
const rowsByModule = new Map();
const stops = [];
let frame = 0;
let isOpen = false;

const style = document.createElement("style");
style.textContent = `
.activity-panel .section-heading{margin-bottom:0}.activity-toggle{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;padding:0;background:transparent;color:inherit;text-align:left;border-radius:0}.activity-toggle:hover{filter:none}.activity-toggle-copy{min-width:0}.activity-toggle-copy .eyebrow{display:block}.activity-toggle-copy h2{margin:3px 0 0}.activity-toggle-meta{display:flex;align-items:center;gap:10px;flex:0 0 auto;color:var(--muted);font-size:11px}.activity-toggle-chevron{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#eef5f3;color:var(--green);font-size:16px;transition:transform .18s ease}.activity-toggle[aria-expanded="true"] .activity-toggle-chevron{transform:rotate(180deg)}.activity-panel .timeline{margin-top:16px}.activity-panel .timeline[hidden]{display:none!important}
`;
document.head.appendChild(style);

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

function rowDateObject(row) {
  const raw = row.submittedAt || row.timestamp || row.savedAt || row.createdAt || row.reportedAt;
  if (raw?.toDate) return raw.toDate();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const date = String(row.date || "").slice(0, 10);
  const time = String(row.time || "00:00").trim() || "00:00";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T${/^\d{1,2}:\d{2}/.test(time) ? time : "00:00"}:00+08:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function operationalDate(row) {
  const dateObj = rowDateObject(row);
  if (!dateObj) return "";
  const parts = localParts(dateObj);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < 7 ? previousDateKey(date) : date;
}

function currentOperationalDate() {
  const parts = localParts();
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < 7 ? previousDateKey(today) : today;
}

function recordTime(row) {
  return rowDateObject(row)?.getTime() || 0;
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function recentText(moduleId, row) {
  if (moduleId === "procedure") return [row.registrationNumber || "Rekod prosedur", [row.zone, row.shift].filter(Boolean).join(" · ")];
  if (moduleId === "asthma") return [row.patientName || row.patientId || "Penilaian asma", [row.categoryBefore, row.categoryAfter].filter(Boolean).join(" → ")];
  if (moduleId === "phc") return [[row.bag, row.shift].filter(Boolean).join(" · ") || "Pemeriksaan PHC", row.ppp || ""];
  return [[row.shift, row.officer].filter(Boolean).join(" · ") || "Pemeriksaan GIRN", `${Array.isArray(row.devices) ? row.devices.length : 0} peralatan`];
}

function ensureToggle() {
  const panel = document.querySelector(".activity-panel");
  const heading = panel?.querySelector(".section-heading");
  const list = document.querySelector("#recentList");
  if (!panel || !heading || !list) return false;
  if (!heading.querySelector(".activity-toggle")) {
    const titleBlock = heading.querySelector("div");
    const currentMeta = heading.querySelector("small")?.textContent || "8 aktiviti terbaru";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "activity-toggle";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "recentList");
    button.innerHTML = `<span class="activity-toggle-copy"><span class="eyebrow">AKTIVITI HARI INI</span><h2>Aliran terkini</h2></span><span class="activity-toggle-meta"><span>${escapeHtml(currentMeta)}</span><span class="activity-toggle-chevron" aria-hidden="true">⌄</span></span>`;
    heading.replaceChildren(button);
    list.hidden = true;
    button.addEventListener("click", () => {
      isOpen = !isOpen;
      button.setAttribute("aria-expanded", String(isOpen));
      list.hidden = !isOpen;
      if (isOpen) renderActivity();
    });
  }
  return true;
}

function renderActivity() {
  if (!ensureToggle()) return;
  const list = document.querySelector("#recentList");
  if (!list) return;
  const day = currentOperationalDate();
  const items = [...rowsByModule.entries()].flatMap(([moduleId, rows]) => rows
    .filter(row => operationalDate(row) === day)
    .map(row => ({ moduleId, row, time:recordTime(row) })))
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);
  list.innerHTML = items.length ? items.map(({ moduleId, row }) => {
    const [title, detail] = recentText(moduleId, row);
    const dateObj = rowDateObject(row);
    const time = dateObj ? dateObj.toLocaleTimeString("ms-MY", { timeZone:TZ, hour:"2-digit", minute:"2-digit" }) : "—";
    return `<a class="timeline-item" href="${moduleLinks[moduleId]}"><time>${escapeHtml(time)}</time><span class="timeline-dot ${moduleId}"></span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml([moduleLabels[moduleId], detail].filter(Boolean).join(" · "))}</small></span></a>`;
  }).join("") : `<p class="empty">Belum ada aktiviti dalam hari operasi ini (07:00–06:59).</p>`;
  list.hidden = !isOpen;
}

function scheduleRender() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    ensureToggle();
    if (isOpen) renderActivity();
  });
}

Object.entries(moduleCollections).forEach(([moduleId, collectionName]) => {
  if (!collectionName) return;
  const stop = onSnapshot(query(collection(db, collectionName), limit(5000)), snapshot => {
    rowsByModule.set(moduleId, snapshot.docs.map(doc => ({ id:doc.id, ...doc.data() })));
    scheduleRender();
  }, error => console.error(`Gagal menyelaras aktiviti ${moduleId}`, error));
  stops.push(stop);
});

const observer = new MutationObserver(scheduleRender);
observer.observe(document.body, { childList:true, subtree:true });
scheduleRender();
window.addEventListener("beforeunload", () => { observer.disconnect(); stops.forEach(stop => stop()); });
