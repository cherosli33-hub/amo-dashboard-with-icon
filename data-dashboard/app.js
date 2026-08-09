import { collection, doc, limit, onSnapshot, query, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth, db } from "../shared/firebase/core.js";
import { logout, prepareAuth } from "../shared/firebase/auth.js";
import { getProfile, isSupervisor } from "../shared/firebase/users.js";
import { COLLECTIONS } from "../shared/firebase/database.js";
import procedure from "./modules/procedure.js";
import asthma from "./modules/asthma.js";
import phc from "./modules/phc.js";
import girn from "./modules/girn.js";
import phcFindings from "./modules/phc-findings.js";
import girnFindings from "./modules/girn-findings.js";
import supervisorAudit from "./modules/supervisor-audit.js";

const primaryModules = [procedure, asthma, phc, girn];
const modules = [...primaryModules, phcFindings, girnFindings, supervisorAudit];
const actionTaskModule = { id:"supervisor-actions", label:"Tindakan Umum", collection:COLLECTIONS.actionTasks, finding:true, filter:row => row.recordType !== "audit" };
const streams = [...modules, actionTaskModule];
const actionSources = [phcFindings, girnFindings, actionTaskModule];
const moduleLinks = { procedure:"../amo.html", asthma:"../asthma.html", phc:"../phc-checklist/", girn:"../girn/" };
const moduleIcons = { procedure:"PR", asthma:"AS", phc:"PH", girn:"GI" };
const shiftDefinitions = [
  { id:"morning", label:"Pagi", aliases:["morning", "pagi"] },
  { id:"evening", label:"Petang", aliases:["evening", "afternoon", "petang"] },
  { id:"night", label:"Malam", aliases:["night", "malam"] }
];
const state = { active:procedure, data:new Map(), ready:new Set(), errors:new Set(), stops:[], selectedActions:new Set(), acting:false };
const number = new Intl.NumberFormat("ms-MY");
const gate = document.querySelector("#gate");
const dashboard = document.querySelector("#dashboard");
const tabs = document.querySelector("#tabs");
const tableHead = document.querySelector("#tableHead");
const tableBody = document.querySelector("#tableBody");
const status = document.querySelector("#status");
const connectionState = document.querySelector("#connectionState");
const lastUpdated = document.querySelector("#lastUpdated");
const search = document.querySelector("#searchInput");
const fromDate = document.querySelector("#fromDate");
const toDate = document.querySelector("#toDate");
const actionList = document.querySelector("#actionList");
const actionCount = document.querySelector("#actionCount");
const actionStatus = document.querySelector("#actionStatus");
const selectAllActions = document.querySelector("#selectAllActions");
const ackSelectedBtn = document.querySelector("#ackSelectedBtn");
const verifySelectedBtn = document.querySelector("#verifySelectedBtn");
const verifyPhcDayBtn = document.querySelector("#verifyPhcDayBtn");
const printDialog = document.querySelector("#printDialog");
let sessionUser = null;
let sessionProfile = null;

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Kuala_Lumpur", year:"numeric", month:"2-digit", day:"2-digit" }).format(date);
}

function dateObject(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function recordDate(row) {
  if (/^\d{4}-\d{2}-\d{2}/.test(String(row.date || ""))) return String(row.date).slice(0, 10);
  const value = row.submittedAt || row.timestamp || row.savedAt || row.createdAt || row.reportedAt || row.actionAt || row.actedAt;
  const parsed = dateObject(value);
  return parsed ? localDateKey(parsed) : "";
}

function recordTime(row) {
  const value = row.submittedAt || row.timestamp || row.savedAt || row.createdAt || row.reportedAt || row.actionAt || row.actedAt || (row.date ? `${row.date}T${row.time || "00:00"}:00+08:00` : "");
  return dateObject(value)?.getTime() || 0;
}

function displayTimestamp(value) {
  const parsed = dateObject(value);
  return parsed ? parsed.toLocaleString("ms-MY", { dateStyle:"medium", timeStyle:"short", timeZone:"Asia/Kuala_Lumpur" }) : value;
}

function valueOf(row, key) {
  const value = row[key];
  if (value == null) return "";
  if (typeof value?.toDate === "function") return displayTimestamp(value);
  if (Array.isArray(value)) return value.map(item => {
    if (typeof item !== "object" || item == null) return item;
    if (item.name) return `${item.name}${item.status ? `: ${item.status}` : ""}${item.orderedBy ? ` · Arahan daripada ${item.orderedBy}` : ""}${item.note ? ` (${item.note})` : ""}`;
    return JSON.stringify(item);
  }).join(" · ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (["submittedAt", "savedAt", "timestamp", "reportedAt", "actionAt", "verifiedAt", "acknowledgedAt", "completedAt", "actedAt"].includes(key)) return displayTimestamp(value);
  return value;
}

function rowsFor(module) { return state.data.get(module.id) || []; }
function todayRows(module) { const today = localDateKey(); return rowsFor(module).filter(row => recordDate(row) === today); }
function normalizedStatus(row) { return String(row.actionStatus || row.state || row.status || "").trim().toLocaleLowerCase("ms-MY"); }
function normalizedType(row) { return String(row.type || "").trim().toLocaleLowerCase("ms-MY"); }

function isOutstanding(module, row) {
  const done = new Set(["selesai", "telah diambil tindakan", "telah diambil maklum", "ditutup", "diambil maklum", "disahkan", "completed", "closed", "acknowledged", "verified"]);
  if (module.id === "phc-findings" && normalizedType(row) !== "note") return false;
  return !done.has(normalizedStatus(row));
}

function filteredRows() {
  const term = search.value.trim().toLocaleLowerCase("ms-MY");
  const from = fromDate.value;
  const to = toDate.value;
  return rowsFor(state.active).filter(row => {
    const date = recordDate(row);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    return !term || JSON.stringify(row, (_key, value) => typeof value?.toDate === "function" ? value.toDate().toISOString() : value).toLocaleLowerCase("ms-MY").includes(term);
  });
}

function renderTable() {
  const rows = filteredRows();
  tableHead.innerHTML = `<tr>${state.active.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>`;
  tableBody.innerHTML = rows.length
    ? rows.slice(0, 1000).map(row => `<tr>${state.active.columns.map(([key]) => `<td class="${["procedures", "devices", "notes", "note", "action"].includes(key) ? "long" : ""}">${escapeHtml(valueOf(row, key))}</td>`).join("")}</tr>`).join("")
    : `<tr class="no-results"><td colspan="${state.active.columns.length}">Tiada rekod sepadan dengan tapisan.</td></tr>`;
  const filterNote = search.value || fromDate.value || toDate.value ? ` daripada ${number.format(rowsFor(state.active).length)}` : "";
  status.textContent = `${number.format(rows.length)}${filterNote} rekod ${state.active.label}${rows.length > 1000 ? " · 1,000 baris pertama dipaparkan" : ""}`;
}

function shiftId(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase("ms-MY");
  return shiftDefinitions.find(shift => shift.aliases.some(alias => normalized.includes(alias)))?.id || "";
}

function issueCounts() {
  const severeAsthma = todayRows(asthma).filter(row => /severe|red/i.test(`${row.categoryBefore} ${row.categoryAfter} ${row.uptriage}`));
  const incompleteAsthma = todayRows(asthma).filter(row => row.pefrNotDone || row.incomplete);
  const phcNotes = rowsFor(phcFindings).filter(row => recordDate(row) === localDateKey() && isOutstanding(phcFindings, row));
  const girnIssues = rowsFor(girnFindings).filter(row => recordDate(row) === localDateKey() && isOutstanding(girnFindings, row));
  const general = rowsFor(actionTaskModule).filter(row => recordDate(row) === localDateKey() && isOutstanding(actionTaskModule, row));
  return { severeAsthma, incompleteAsthma, phcNotes, girnIssues, general };
}

function renderHero() {
  const now = new Date();
  const currentHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone:"Asia/Kuala_Lumpur", hour:"2-digit", hourCycle:"h23" }).format(now));
  const activeShift = currentHour >= 22 || currentHour < 7 ? "Malam" : currentHour < 15 ? "Pagi" : "Petang";
  document.querySelector("#todayContext").textContent = `${now.toLocaleDateString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", weekday:"long", day:"numeric", month:"long", year:"numeric" })} · Syif ${activeShift} · ${sessionProfile?.name || "Penyelia"}`;
  const issues = issueCounts();
  const total = Object.values(issues).reduce((sum, list) => sum + list.length, 0);
  const critical = issues.severeAsthma.length + issues.girnIssues.filter(row => /kritikal|critical|tidak berfungsi|rosak/i.test(`${row.inspectionStatus} ${row.state} ${row.note}`)).length;
  const card = document.querySelector("#pulseCard");
  card.className = `pulse-card ${critical ? "is-critical" : total ? "is-warning" : "is-normal"}`;
  document.querySelector("#pulseLabel").textContent = critical ? "TINDAKAN DIPERLUKAN" : total ? "PERLU PERHATIAN" : "OPERASI NORMAL";
  document.querySelector("#pulseDetail").textContent = total ? `${number.format(total)} perkara sedang dipantau` : "Tiada tindakan diperlukan sekarang";
}

function renderModuleCards() {
  const issues = issueCounts();
  const phcShifts = new Set(todayRows(phc).map(row => shiftId(row.shift)).filter(Boolean));
  const girnShifts = new Set(todayRows(girn).map(row => shiftId(row.shift)).filter(Boolean));
  const cards = [
    { module:procedure, value:todayRows(procedure).length, label:"prosedur hari ini", note:"Log kes diterima", tone:"blue" },
    { module:asthma, value:todayRows(asthma).length, label:"penilaian hari ini", note:issues.severeAsthma.length || issues.incompleteAsthma.length ? `${issues.severeAsthma.length + issues.incompleteAsthma.length} perlu perhatian` : "Semua rekod stabil", tone:"amber" },
    { module:phc, value:`${phcShifts.size}/3`, label:"syif direkod", note:issues.phcNotes.length ? `${issues.phcNotes.length} Tindakan Catatan` : "Tiada catatan tertunggak", tone:"green" },
    { module:girn, value:`${girnShifts.size}/3`, label:"syif diperiksa", note:issues.girnIssues.length ? `${issues.girnIssues.length} isu ditemui` : "Tiada isu tertunggak", tone:"purple" }
  ];
  document.querySelector("#moduleCards").innerHTML = cards.map(card => `<a class="module-card ${card.tone}" href="${moduleLinks[card.module.id]}"><span class="module-icon">${moduleIcons[card.module.id]}</span><span class="module-copy"><small>${escapeHtml(card.module.label)}</small><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span><em>${escapeHtml(card.note)}</em></span><b aria-hidden="true">↗</b></a>`).join("");
}

function attentionItems() {
  const issues = issueCounts();
  const items = [];
  if (issues.severeAsthma.length) items.push({ tone:"critical", icon:"AS", title:`Asma: ${issues.severeAsthma.length} rekod Severe / Red Zone`, detail:"Semak penilaian dan tindakan klinikal yang direkod.", module:asthma });
  if (issues.incompleteAsthma.length) items.push({ tone:"warning", icon:"AS", title:`Asma: ${issues.incompleteAsthma.length} rekod PEFR tidak lengkap`, detail:"Sebab PEFR Not Done tersedia dalam rekod.", module:asthma });
  if (issues.phcNotes.length) items.push({ tone:"warning", icon:"PH", title:`PHC: ${issues.phcNotes.length} Tindakan Catatan`, detail:"Restock tidak termasuk dalam senarai penyelia.", module:phcFindings });
  if (issues.girnIssues.length) items.push({ tone:"critical", icon:"GI", title:`GIRN: ${issues.girnIssues.length} penemuan belum selesai`, detail:"Semak status radio dan tindakan susulan.", module:girnFindings });
  if (issues.general.length) items.push({ tone:"warning", icon:"AM", title:`${issues.general.length} notifikasi umum`, detail:"Tindakan daripada modul lain menunggu semakan.", module:actionTaskModule });
  return items;
}

function renderAttention() {
  const items = attentionItems();
  document.querySelector("#attentionCount").textContent = number.format(items.reduce((sum, item) => sum + Number(item.title.match(/\d+/)?.[0] || 0), 0));
  document.querySelector("#attentionList").innerHTML = items.length ? items.map(item => `<button class="attention-item ${item.tone}" type="button" data-attention-module="${item.module.id}"><span>${item.icon}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><b>›</b></button>`).join("") : `<div class="all-clear"><span>✓</span><div><strong>Tiada tindakan diperlukan sekarang</strong><small>Semua aliran yang diterima berada dalam keadaan baik.</small></div></div>`;
  document.querySelectorAll("[data-attention-module]").forEach(button => button.addEventListener("click", () => selectModule(modules.find(module => module.id === button.dataset.attentionModule) || procedure)));
}

function renderShifts() {
  document.querySelector("#shiftCards").innerHTML = shiftDefinitions.map(shift => {
    const phcDone = todayRows(phc).some(row => shiftId(row.shift) === shift.id);
    const girnDone = todayRows(girn).some(row => shiftId(row.shift) === shift.id);
    const completed = Number(phcDone) + Number(girnDone);
    return `<article class="shift-card"><div class="shift-ring" style="--progress:${completed * 50}%"><span>${completed}/2</span></div><div><strong>${shift.label}</strong><small><i class="${phcDone ? "done" : "pending"}">${phcDone ? "✓" : "·"}</i> PHC ${phcDone ? "selesai" : "belum"}</small><small><i class="${girnDone ? "done" : "pending"}">${girnDone ? "✓" : "·"}</i> GIRN ${girnDone ? "selesai" : "belum"}</small></div></article>`;
  }).join("");
}

function recentText(module, row) {
  if (module.id === "procedure") return [row.registrationNumber || "Rekod prosedur", [row.zone, row.shift].filter(Boolean).join(" · ")];
  if (module.id === "asthma") return [row.patientName || row.patientId || "Penilaian asma", [row.categoryBefore, row.categoryAfter].filter(Boolean).join(" → ")];
  if (module.id === "phc") return [[row.bag, row.shift].filter(Boolean).join(" · ") || "Pemeriksaan PHC", row.ppp || ""];
  return [[row.shift, row.officer].filter(Boolean).join(" · ") || "Pemeriksaan GIRN", `${Array.isArray(row.devices) ? row.devices.length : 0} peralatan`];
}

function renderRecent() {
  const today = localDateKey();
  const items = primaryModules.flatMap(module => rowsFor(module).filter(row => recordDate(row) === today).map(row => ({ module, row, time:recordTime(row) }))).sort((a, b) => b.time - a.time).slice(0, 8);
  document.querySelector("#recentList").innerHTML = items.length ? items.map(({ module, row }) => {
    const [title, detail] = recentText(module, row);
    const time = dateObject(row.submittedAt || row.timestamp || row.savedAt || `${row.date}T${row.time || "00:00"}:00+08:00`)?.toLocaleTimeString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", hour:"2-digit", minute:"2-digit" }) || "—";
    return `<button class="timeline-item" type="button" data-module="${module.id}"><time>${escapeHtml(time)}</time><span class="timeline-dot ${module.id}"></span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml([module.label, detail].filter(Boolean).join(" · "))}</small></span></button>`;
  }).join("") : `<p class="empty">Belum ada aktiviti diterima hari ini.</p>`;
  document.querySelectorAll("[data-module]").forEach(button => button.addEventListener("click", () => selectModule(modules.find(module => module.id === button.dataset.module))));
}

function lastSevenDays() {
  return Array.from({ length:7 }, (_, index) => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
    return { key:localDateKey(date), short:date.toLocaleDateString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", weekday:"short" }) };
  });
}

function renderWeekTrend() {
  const days = lastSevenDays();
  const totals = days.map(day => primaryModules.reduce((sum, module) => sum + rowsFor(module).filter(row => recordDate(row) === day.key).length, 0));
  const maximum = Math.max(1, ...totals);
  document.querySelector("#weekSummary").innerHTML = primaryModules.map(module => {
    const total = rowsFor(module).filter(row => days.some(day => day.key === recordDate(row))).length;
    return `<div><span>${module.label}</span><strong>${number.format(total)}</strong></div>`;
  }).join("");
  document.querySelector("#weekTrend").innerHTML = days.map((day, index) => `<div class="trend-day"><span class="trend-value">${number.format(totals[index])}</span><i style="--height:${Math.max(7, Math.round((totals[index] / maximum) * 100))}%"></i><small>${escapeHtml(day.short)}</small></div>`).join("");
}

function actionKey(module, row) { return `${module.id}:${row.id}`; }
function actionItems() {
  return actionSources.flatMap(module => rowsFor(module).filter(row => isOutstanding(module, row)).map(row => ({ module, row, key:actionKey(module, row), time:recordTime(row) }))).sort((a, b) => b.time - a.time);
}

function actionTitleFor(module, row) {
  if (module.id === "phc-findings") return row.item || row.note || "Tindakan Catatan PHC";
  if (module.id === "girn-findings") return row.device || row.inspectionStatus || "Penemuan GIRN";
  return row.title || row.subject || row.type || "Tindakan penyelia";
}
function actionDetailFor(module, row) {
  if (module.id === "phc-findings") return [row.date, row.bagShift, row.note].filter(Boolean).join(" · ");
  if (module.id === "girn-findings") return [row.date, row.shift, row.inspectionStatus, row.note, row.reporter].filter(Boolean).join(" · ");
  return [recordDate(row), row.module, row.message || row.detail || row.note, row.reporter || row.createdBy].filter(Boolean).join(" · ");
}
function actionBadgeFor(module, row) {
  if (row.requiredAction || row.actionType) return row.requiredAction || row.actionType;
  if (module.id === "phc-findings") return "PHC · Tindakan Catatan";
  if (module.id === "girn-findings") return "GIRN · Perlu tindakan";
  return "Perlu tindakan";
}

function phcDailyState() {
  const records = todayRows(phc);
  const unverified = records.filter(row => row.verified !== true);
  const audit = rowsFor(supervisorAudit).find(row => row.sourceModule === "phc-daily" && (row.sourceDate === localDateKey() || recordDate(row) === localDateKey()));
  return { records, unverified, audit, complete:Boolean(records.length && (!unverified.length || audit)) };
}

function renderPhcDaily() {
  const daily = phcDailyState();
  const title = document.querySelector("#phcDailyTitle");
  const detail = document.querySelector("#phcDailyDetail");
  const card = document.querySelector("#phcDailyCard");
  card.classList.toggle("complete", daily.complete);
  if (!daily.records.length) {
    title.textContent = "Belum ada rekod PHC hari ini";
    detail.textContent = "Pengesahan tersedia selepas pemeriksaan diterima.";
  } else if (daily.complete) {
    title.textContent = `Pengesahan hari ini selesai · ${daily.records.length} rekod`;
    detail.textContent = daily.audit?.actorName ? `Disahkan oleh ${daily.audit.actorName}.` : `Semua rekod telah disahkan.`;
  } else {
    title.textContent = `${daily.records.length} rekod PHC sedia untuk pengesahan harian`;
    detail.textContent = `${daily.unverified.length} belum disahkan · satu klik mengesahkan keseluruhan hari.`;
  }
  verifyPhcDayBtn.textContent = daily.complete ? "✓ Sudah disahkan" : "Sahkan hari ini";
  verifyPhcDayBtn.disabled = state.acting || !daily.records.length || daily.complete;
}

function renderActions() {
  const items = actionItems();
  const existing = new Set(items.map(item => item.key));
  [...state.selectedActions].forEach(key => { if (!existing.has(key)) state.selectedActions.delete(key); });
  actionCount.textContent = number.format(items.length + (phcDailyState().records.length && !phcDailyState().complete ? 1 : 0));
  actionList.innerHTML = items.length ? items.map(({ module, row, key }) => `<label class="action-item ${state.selectedActions.has(key) ? "selected" : ""}"><span class="action-check"><input type="checkbox" data-action-key="${escapeHtml(key)}" ${state.selectedActions.has(key) ? "checked" : ""}></span><span class="action-copy"><strong>${escapeHtml(actionTitleFor(module, row))}</strong><span>${escapeHtml(actionDetailFor(module, row) || "Tiada catatan tambahan")}</span></span><span class="action-badge">${escapeHtml(actionBadgeFor(module, row))}</span></label>`).join("") : `<div class="action-empty">✓ Tiada Tindakan Catatan atau isu modul yang tertunggak.</div>`;
  actionList.querySelectorAll("[data-action-key]").forEach(input => input.addEventListener("change", () => { input.checked ? state.selectedActions.add(input.dataset.actionKey) : state.selectedActions.delete(input.dataset.actionKey); renderActions(); }));
  const selectedCount = state.selectedActions.size;
  ackSelectedBtn.disabled = state.acting || selectedCount === 0;
  verifySelectedBtn.disabled = state.acting || selectedCount === 0;
  const allSelected = items.length > 0 && items.every(item => state.selectedActions.has(item.key));
  selectAllActions.checked = allSelected;
  selectAllActions.indeterminate = !allSelected && selectedCount > 0;
  selectAllActions.disabled = state.acting || items.length === 0;
  renderPhcDaily();
}

function actorName() { return sessionProfile?.name || sessionUser?.displayName || sessionUser?.email || "Penyelia"; }
function changesForAction(module, mode) {
  const actor = actorName();
  const email = sessionUser?.email || sessionProfile?.email || "";
  const label = mode === "verify" ? "Disahkan" : "Diambil maklum";
  const common = { action:label, actionBy:actor, actionByEmail:email, actionAt:serverTimestamp() };
  if (module.id === "phc-findings") return mode === "verify" ? { ...common, status:"Selesai", verifiedBy:actor, verifiedByEmail:email, verifiedAt:serverTimestamp() } : { ...common, status:"Telah diambil maklum", acknowledgedBy:actor, acknowledgedByEmail:email, acknowledgedAt:serverTimestamp() };
  if (module.id === "girn-findings") return mode === "verify" ? { ...common, state:"Selesai", verifiedBy:actor, verifiedByEmail:email, verifiedAt:serverTimestamp() } : { ...common, state:"Diambil maklum", acknowledgedBy:actor, acknowledgedByEmail:email, acknowledgedAt:serverTimestamp() };
  return { ...common, status:"selesai", state:"selesai", completedBy:actor, completedByEmail:email, completedAt:serverTimestamp() };
}

async function runSelectedAction(mode) {
  const items = actionItems().filter(item => state.selectedActions.has(item.key));
  if (!items.length || state.acting) return;
  const title = mode === "verify" ? "Sahkan" : "Ambil maklum";
  if (!confirm(`${title} ${items.length} tindakan terpilih?`)) return;
  state.acting = true; actionStatus.textContent = `Menyimpan ${items.length} tindakan…`; renderActions();
  try {
    for (let index = 0; index < items.length; index += 200) {
      const chunk = items.slice(index, index + 200); const batch = writeBatch(db);
      chunk.forEach(({ module, row }) => {
        batch.update(doc(db, module.collection, row.id), changesForAction(module, mode));
        batch.set(doc(collection(db, COLLECTIONS.actionTasks)), { recordType:"audit", status:"completed", state:"completed", sourceCollection:module.collection, sourceId:row.id, sourceModule:module.id, sourceTitle:actionTitleFor(module, row), sourceDetail:actionDetailFor(module, row), actionType:mode, actionLabel:mode === "verify" ? "Disahkan" : "Diambil maklum", actorUid:sessionUser?.uid || "", actorName:actorName(), actorEmail:sessionUser?.email || sessionProfile?.email || "", actorRole:sessionProfile?.role || "", actedAt:serverTimestamp() });
      });
      await batch.commit();
    }
    state.selectedActions.clear(); actionStatus.textContent = `${items.length} tindakan berjaya dikemas kini oleh ${actorName()}.`;
  } catch (error) { console.error("Tindakan penyelia gagal", error); actionStatus.textContent = error.message || "Tindakan gagal disimpan."; }
  finally { state.acting = false; renderActions(); }
}

async function verifyPhcDay() {
  const daily = phcDailyState();
  if (state.acting || daily.complete || !daily.records.length) return;
  if (!confirm(`Sahkan keseluruhan ${daily.records.length} rekod PHC untuk hari ini? Pengesahan ini dibuat sekali sehari.`)) return;
  state.acting = true; actionStatus.textContent = "Menyimpan pengesahan PHC harian…"; renderActions();
  try {
    const chunks = [];
    for (let index = 0; index < daily.unverified.length; index += 399) chunks.push(daily.unverified.slice(index, index + 399));
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const batch = writeBatch(db);
      chunk.forEach(row => batch.update(doc(db, phc.collection, row.id), { verified:true, verifiedBy:actorName(), verifiedEmail:sessionUser?.email || sessionProfile?.email || "", verifiedAt:serverTimestamp() }));
      if (chunkIndex === chunks.length - 1) batch.set(doc(collection(db, COLLECTIONS.actionTasks)), { recordType:"audit", status:"completed", state:"completed", sourceCollection:phc.collection, sourceModule:"phc-daily", sourceDate:localDateKey(), sourceTitle:`Pengesahan PHC harian ${localDateKey()}`, sourceDetail:`${daily.records.length} rekod disahkan sekali untuk keseluruhan hari`, recordIds:daily.records.map(row => row.id), actionType:"daily-verify", actionLabel:"Pengesahan harian", actorUid:sessionUser?.uid || "", actorName:actorName(), actorEmail:sessionUser?.email || sessionProfile?.email || "", actorRole:sessionProfile?.role || "", actedAt:serverTimestamp() });
      await batch.commit();
    }
    actionStatus.textContent = `${daily.records.length} rekod PHC disahkan sekali untuk hari ini oleh ${actorName()}.`;
  } catch (error) { console.error("Pengesahan PHC harian gagal", error); actionStatus.textContent = error.message || "Pengesahan harian gagal disimpan."; }
  finally { state.acting = false; renderActions(); }
}

function renderConnection() {
  if (state.errors.size) { connectionState.textContent = `${state.errors.size} aliran gagal disambung`; connectionState.className = "error"; }
  else if (state.ready.size < streams.length) { connectionState.textContent = `Menyambung ${state.ready.size}/${streams.length} aliran…`; connectionState.className = ""; }
  else { connectionState.textContent = "● Semua data langsung"; connectionState.className = ""; }
}

function renderAll() {
  renderHero(); renderModuleCards(); renderAttention(); renderShifts(); renderRecent(); renderWeekTrend(); renderActions(); renderTable(); renderConnection();
  lastUpdated.textContent = `Dikemas kini ${new Date().toLocaleTimeString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", hour:"2-digit", minute:"2-digit", second:"2-digit" })}`;
}

function selectModule(module) {
  if (!module?.columns) return;
  state.active = module;
  [...tabs.children].forEach(button => button.classList.toggle("active", button.dataset.id === module.id));
  renderTable();
  document.querySelector(".data-panel").scrollIntoView({ behavior:"smooth", block:"start" });
}

function startLiveData() {
  streams.forEach(module => {
    const stop = onSnapshot(query(collection(db, module.collection), limit(5000)), snapshot => {
      const rows = snapshot.docs.map(item => ({ id:item.id, ...item.data() })).filter(row => !module.filter || module.filter(row)).sort((a, b) => recordTime(b) - recordTime(a));
      state.data.set(module.id, rows); state.ready.add(module.id); state.errors.delete(module.id); renderAll();
    }, error => { console.error(`Gagal membaca ${module.collection}`, error); state.errors.add(module.id); renderConnection(); });
    state.stops.push(stop);
  });
}

function exportCsv() {
  const rows = filteredRows(); const columns = state.active.columns; const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [columns.map(([, label]) => quote(label)).join(","), ...rows.map(row => columns.map(([key]) => quote(valueOf(row, key))).join(","))].join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type:"text/csv;charset=utf-8" })); link.download = `amo-v2-${state.active.id}-${localDateKey()}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

function filterDescription() {
  const parts = [];
  if (fromDate.value || toDate.value) parts.push(`Tempoh: ${fromDate.value || "awal"} hingga ${toDate.value || "terkini"}`);
  if (search.value.trim()) parts.push(`Carian: “${search.value.trim()}”`);
  return parts.length ? parts.join(" · ") : "Semua rekod dalam data semasa";
}

function openPrintPreview() {
  const rows = filteredRows(); const columns = state.active.columns;
  document.querySelector("#printReport").innerHTML = `<header class="print-head"><div class="print-brand">AMO</div><div><small>HOSPITAL KUALA LIPIS · EMERGENCY & TRAUMA DEPARTMENT</small><h1>Laporan ${escapeHtml(state.active.label)}</h1><p>${escapeHtml(filterDescription())}</p></div><dl><dt>Dijana</dt><dd>${escapeHtml(new Date().toLocaleString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", dateStyle:"medium", timeStyle:"short" }))}</dd><dt>Rekod</dt><dd>${number.format(rows.length)}</dd></dl></header><section class="print-context"><div><small>MODUL</small><strong>${escapeHtml(state.active.label)}</strong></div><div><small>TEMPOH</small><strong>${escapeHtml(fromDate.value || "Semua")} — ${escapeHtml(toDate.value || "Terkini")}</strong></div><div><small>DISEDIAKAN OLEH</small><strong>${escapeHtml(actorName())}</strong></div></section><section class="print-table-wrap"><table><thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${columns.map(([key]) => `<td>${escapeHtml(valueOf(row, key))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}" class="print-empty">Tiada rekod sepadan dengan tapisan.</td></tr>`}</tbody></table></section><footer>Laporan dijana daripada Dashboard Penerima AMO v2 · Data mengikut modul dan tapisan yang dipilih.</footer>`;
  document.querySelector("#previewHint").textContent = `${rows.length} rekod · ${filterDescription()}`;
  document.body.classList.add("preview-open"); printDialog.showModal();
}

function closePrintPreview() { if (printDialog.open) printDialog.close(); document.body.classList.remove("preview-open", "printing"); }
function printReport() { document.body.classList.add("printing"); window.print(); }

modules.forEach(module => {
  const button = document.createElement("button"); button.type = "button"; button.dataset.id = module.id; button.textContent = module.label; button.addEventListener("click", () => selectModule(module)); tabs.append(button);
});
[search, fromDate, toDate].forEach(input => input.addEventListener("input", renderTable));
document.querySelector("#resetBtn").addEventListener("click", () => { search.value = ""; fromDate.value = ""; toDate.value = ""; renderTable(); });
document.querySelector("#csvBtn").addEventListener("click", exportCsv);
document.querySelector("#printPreviewBtn").addEventListener("click", openPrintPreview);
document.querySelector("#closePreviewBtn").addEventListener("click", closePrintPreview);
document.querySelector("#printBtn").addEventListener("click", printReport);
printDialog.addEventListener("cancel", event => { event.preventDefault(); closePrintPreview(); });
window.addEventListener("afterprint", () => document.body.classList.remove("printing"));
document.querySelector("#logoutBtn").addEventListener("click", async () => { state.stops.forEach(stop => stop()); await logout(); location.href = "../"; });
selectAllActions.addEventListener("change", () => { const items = actionItems(); selectAllActions.checked ? items.forEach(item => state.selectedActions.add(item.key)) : state.selectedActions.clear(); renderActions(); });
ackSelectedBtn.addEventListener("click", () => runSelectedAction("acknowledge"));
verifySelectedBtn.addEventListener("click", () => runSelectedAction("verify"));
verifyPhcDayBtn.addEventListener("click", verifyPhcDay);
window.addEventListener("beforeunload", () => state.stops.forEach(stop => stop()));

await prepareAuth();
const user = await new Promise(resolve => { const stop = onAuthStateChanged(auth, value => { stop(); resolve(value); }); });
const profile = user && !user.isAnonymous ? await getProfile(user.uid).catch(() => null) : null;
if (!user || user.isAnonymous || !isSupervisor(profile)) {
  gate.innerHTML = `<h2>Akses tidak dibenarkan</h2><p>Log masuk di dashboard utama menggunakan akaun admin atau penyelia yang diluluskan.</p><a href="../">Kembali ke dashboard utama</a>`;
} else {
  sessionUser = user; sessionProfile = profile;
  document.querySelector("#userLabel").textContent = `${profile.name || user.displayName || user.email} · ${profile.role === "admin" ? "Admin" : "Penyelia"}`;
  document.querySelector("#supervisorCentre").hidden = false;
  gate.hidden = true; dashboard.hidden = false;
  [...tabs.children].find(button => button.dataset.id === state.active.id)?.classList.add("active");
  renderAll(); startLiveData();
}
