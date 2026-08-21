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
import { buildDailyComplianceSummary, buildDailyVerificationStates, latestRowsBySlot, selectAllDailyVerificationKeys } from "./modules/phc-summary.mjs";

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
const state = { active:procedure, data:new Map(), ready:new Set(), errors:new Set(), stops:[], selectedActions:new Set(), selectedDailyVerifications:new Set(), acting:false, reportHtml:"", reportMonth:"", reportDirty:true };
const number = new Intl.NumberFormat("ms-MY");
const gate = document.querySelector("#gate");
const dashboard = document.querySelector("#dashboard");
const tabs = document.querySelector("#tabs");
const status = document.querySelector("#status");
const connectionState = document.querySelector("#connectionState");
const lastUpdated = document.querySelector("#lastUpdated");
const reportMonth = document.querySelector("#reportMonth");
const reportPreview = document.querySelector("#monthlyReportPreview");
const generateReportBtn = document.querySelector("#generateReportBtn");
const printPreviewBtn = document.querySelector("#printPreviewBtn");
const actionList = document.querySelector("#actionList");
const actionCount = document.querySelector("#actionCount");
const actionStatus = document.querySelector("#actionStatus");
const selectAllActions = document.querySelector("#selectAllActions");
const ackSelectedBtn = document.querySelector("#ackSelectedBtn");
const verifySelectedBtn = document.querySelector("#verifySelectedBtn");
const phcDailyList = document.querySelector("#phcDailyList");
const girnDailyList = document.querySelector("#girnDailyList");
const selectAllDailyVerifications = document.querySelector("#selectAllDailyVerifications");
const verifySelectedDailyBtn = document.querySelector("#verifySelectedDailyBtn");
const supervisorFolderToggle = document.querySelector("#supervisorFolderToggle");
const supervisorFolderContent = document.querySelector("#supervisorFolderContent");
const printDialog = document.querySelector("#printDialog");
let sessionUser = null;
let sessionProfile = null;
const adminEmails = new Set(["cherosli33@gmail.com", "cherosli@moh.gov.my"]);

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

function sessionEmail() {
  return String(sessionUser?.email || sessionProfile?.email || "").trim().toLowerCase();
}

function roleLabel() {
  return sessionProfile?.role === "admin" || adminEmails.has(sessionEmail()) ? "Admin" : "Penyelia";
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
  document.querySelector("#todayContext").textContent = `${now.toLocaleDateString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", weekday:"long", day:"numeric", month:"long", year:"numeric" })} · Syif ${activeShift} · ${roleLabel()}`;
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
  document.querySelectorAll("[data-attention-module]").forEach(button => button.addEventListener("click", () => {
    const module = modules.find(item => item.id === button.dataset.attentionModule);
    if (primaryModules.includes(module)) selectModule(module);
    else document.querySelector("#supervisorCentre").scrollIntoView({ behavior:"smooth", block:"start" });
  }));
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

function dailyVerificationStates(module) {
  return buildDailyVerificationStates(rowsFor(module), rowsFor(supervisorAudit), `${module.id}-daily`, recordDate);
}

function dailyVerificationItems() {
  return [phc, girn].flatMap(module => dailyVerificationStates(module).filter(day => !day.complete).map(day => ({ module, day, key:`${module.id}:${day.date}` })));
}

function renderDailyVerificationModule(module, container, items) {
  const moduleItems = items.filter(item => item.module.id === module.id);
  if (!moduleItems.length) {
    container.innerHTML = `<div class="action-empty">✓ Tiada pengesahan ${escapeHtml(module.label)} tertunggak.</div>`;
    return;
  }
  container.innerHTML = moduleItems.map(({ day, key }) => {
    const dateLabel = new Date(`${day.date}T12:00:00+08:00`).toLocaleDateString("ms-MY", { day:"numeric", month:"short", year:"numeric", timeZone:"Asia/Kuala_Lumpur" });
    const selected = state.selectedDailyVerifications.has(key);
    return `<article class="daily-verification ${selected ? "selected" : ""}"><label class="daily-check"><input type="checkbox" data-daily-key="${escapeHtml(key)}" ${selected ? "checked" : ""} ${state.acting ? "disabled" : ""}><span class="sr-only">Pilih ${escapeHtml(module.label)} ${escapeHtml(dateLabel)}</span></label><div class="daily-icon" aria-hidden="true">${escapeHtml(module.label)}</div><div class="daily-copy"><small>PENGESAHAN TERTUNGGAK</small><strong>${escapeHtml(dateLabel)} · ${number.format(day.records.length)} rekod</strong><span>${number.format(day.unverified.length)} rekod belum disahkan.</span></div><button type="button" data-daily-verify="${escapeHtml(key)}" ${state.acting ? "disabled" : ""}>Sahkan</button></article>`;
  }).join("");
}

function renderDailyVerifications() {
  const items = dailyVerificationItems();
  const existing = new Set(items.map(item => item.key));
  [...state.selectedDailyVerifications].forEach(key => { if (!existing.has(key)) state.selectedDailyVerifications.delete(key); });
  renderDailyVerificationModule(phc, phcDailyList, items);
  renderDailyVerificationModule(girn, girnDailyList, items);
  document.querySelectorAll("[data-daily-key]").forEach(input => input.addEventListener("change", () => { input.checked ? state.selectedDailyVerifications.add(input.dataset.dailyKey) : state.selectedDailyVerifications.delete(input.dataset.dailyKey); renderActions(); }));
  document.querySelectorAll("[data-daily-verify]").forEach(button => button.addEventListener("click", () => verifyDailyVerifications([button.dataset.dailyVerify])));
  const selectedCount = state.selectedDailyVerifications.size;
  const allSelected = items.length > 0 && items.every(item => state.selectedDailyVerifications.has(item.key));
  selectAllDailyVerifications.checked = allSelected;
  selectAllDailyVerifications.indeterminate = !allSelected && selectedCount > 0;
  selectAllDailyVerifications.disabled = state.acting || items.length === 0;
  verifySelectedDailyBtn.disabled = state.acting || selectedCount === 0;
  verifySelectedDailyBtn.textContent = selectedCount ? `✓ Sahkan dipilih (${number.format(selectedCount)})` : "✓ Sahkan dipilih";
}

function renderActions() {
  const items = actionItems();
  const existing = new Set(items.map(item => item.key));
  [...state.selectedActions].forEach(key => { if (!existing.has(key)) state.selectedActions.delete(key); });
  actionCount.textContent = number.format(items.length + dailyVerificationItems().length);
  actionList.innerHTML = items.length ? items.map(({ module, row, key }) => `<label class="action-item ${state.selectedActions.has(key) ? "selected" : ""}"><span class="action-check"><input type="checkbox" data-action-key="${escapeHtml(key)}" ${state.selectedActions.has(key) ? "checked" : ""}></span><span class="action-copy"><strong>${escapeHtml(actionTitleFor(module, row))}</strong><span>${escapeHtml(actionDetailFor(module, row) || "Tiada catatan tambahan")}</span></span><span class="action-badge">${escapeHtml(actionBadgeFor(module, row))}</span></label>`).join("") : `<div class="action-empty">✓ Tiada Tindakan Catatan atau isu modul yang tertunggak.</div>`;
  actionList.querySelectorAll("[data-action-key]").forEach(input => input.addEventListener("change", () => { input.checked ? state.selectedActions.add(input.dataset.actionKey) : state.selectedActions.delete(input.dataset.actionKey); renderActions(); }));
  const selectedCount = state.selectedActions.size;
  ackSelectedBtn.disabled = state.acting || selectedCount === 0;
  verifySelectedBtn.disabled = state.acting || selectedCount === 0;
  const allSelected = items.length > 0 && items.every(item => state.selectedActions.has(item.key));
  selectAllActions.checked = allSelected;
  selectAllActions.indeterminate = !allSelected && selectedCount > 0;
  selectAllActions.disabled = state.acting || items.length === 0;
  renderDailyVerifications();
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

async function verifyDailyVerifications(keys) {
  const requested = new Set(keys);
  const items = dailyVerificationItems().filter(item => requested.has(item.key));
  if (state.acting || !items.length) return;
  const recordCount = items.reduce((sum, item) => sum + item.day.unverified.length, 0);
  const moduleLabels = [...new Set(items.map(item => item.module.label))].join(" & ");
  if (!confirm(`Sahkan ${items.length} pengesahan harian ${moduleLabels} melibatkan ${recordCount} rekod?`)) return;
  state.acting = true; actionStatus.textContent = `Menyimpan ${items.length} pengesahan harian…`; renderActions();
  try {
    for (const { module, day } of items) {
      const chunks = [];
      for (let index = 0; index < day.unverified.length; index += 399) chunks.push(day.unverified.slice(index, index + 399));
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const batch = writeBatch(db);
        chunk.forEach(row => batch.update(doc(db, module.collection, row.id), { verified:true, verifiedBy:actorName(), verifiedEmail:sessionUser?.email || sessionProfile?.email || "", verifiedAt:serverTimestamp() }));
        if (chunkIndex === chunks.length - 1) batch.set(doc(collection(db, COLLECTIONS.actionTasks)), { recordType:"audit", status:"completed", state:"completed", sourceCollection:module.collection, sourceModule:`${module.id}-daily`, sourceDate:day.date, sourceTitle:`Pengesahan ${module.label} harian ${day.date}`, sourceDetail:`${day.records.length} rekod disahkan sekali untuk keseluruhan hari`, recordIds:day.records.map(row => row.id), actionType:"daily-verify", actionLabel:"Pengesahan harian", actorUid:sessionUser?.uid || "", actorName:actorName(), actorEmail:sessionUser?.email || sessionProfile?.email || "", actorRole:sessionProfile?.role || "", actedAt:serverTimestamp() });
        await batch.commit();
      }
    }
    items.forEach(item => state.selectedDailyVerifications.delete(item.key));
    actionStatus.textContent = `${items.length} pengesahan harian ${moduleLabels} berjaya disahkan oleh ${actorName()}.`;
  } catch (error) { console.error("Pengesahan harian gagal", error); actionStatus.textContent = error.message || "Pengesahan harian gagal disimpan."; }
  finally { state.acting = false; renderActions(); }
}

function renderConnection() {
  if (state.errors.size) { connectionState.textContent = `${state.errors.size} aliran gagal disambung`; connectionState.className = "error"; }
  else if (state.ready.size < streams.length) { connectionState.textContent = `Menyambung ${state.ready.size}/${streams.length} aliran…`; connectionState.className = ""; }
  else { connectionState.textContent = "● Semua data langsung"; connectionState.className = ""; }
}

function renderAll() {
  renderHero(); renderModuleCards(); renderAttention(); renderShifts(); renderRecent(); renderActions(); renderConnection();
  lastUpdated.textContent = `Dikemas kini ${new Date().toLocaleTimeString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", hour:"2-digit", minute:"2-digit", second:"2-digit" })}`;
}

function selectModule(module) {
  if (!primaryModules.includes(module)) return;
  state.active = module;
  [...tabs.children].forEach(button => button.classList.toggle("active", button.dataset.id === module.id));
  state.reportHtml = "";
  state.reportDirty = true;
  reportPreview.innerHTML = `<p class="empty">Tekan <strong>Jana laporan bulanan</strong> untuk melihat ringkasan ${escapeHtml(module.label)}.</p>`;
  status.textContent = `Laporan ${module.label} belum dijana.`;
  printPreviewBtn.disabled = true;
  document.querySelector(".data-panel").scrollIntoView({ behavior:"smooth", block:"start" });
}

function startLiveData() {
  streams.forEach(module => {
    const stop = onSnapshot(query(collection(db, module.collection), limit(5000)), snapshot => {
      const rows = snapshot.docs.map(item => ({ id:item.id, ...item.data() })).filter(row => !module.filter || module.filter(row)).sort((a, b) => recordTime(b) - recordTime(a));
      state.data.set(module.id, rows); state.ready.add(module.id); state.errors.delete(module.id); state.reportDirty = true; renderAll();
    }, error => { console.error(`Gagal membaca ${module.collection}`, error); state.errors.add(module.id); renderConnection(); });
    state.stops.push(stop);
  });
}

function selectedMonthMeta() {
  const value = reportMonth.value || localDateKey().slice(0, 7);
  const [year, month] = value.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const label = new Intl.DateTimeFormat("ms-MY", { month:"long", year:"numeric", timeZone:"Asia/Kuala_Lumpur" }).format(new Date(`${value}-15T12:00:00+08:00`));
  const days = Array.from({ length:daysInMonth }, (_, index) => `${value}-${String(index + 1).padStart(2, "0")}`);
  return { value, year, month, daysInMonth, days, label };
}

function monthlyRows(module) {
  const prefix = selectedMonthMeta().value;
  return rowsFor(module).filter(row => recordDate(row).startsWith(prefix));
}

function kpi(label, value, note = "", tone = "") {
  return `<div class="report-kpi ${tone ? `kpi-${escapeHtml(tone)}` : ""}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong>${note ? `<span>${escapeHtml(note)}</span>` : ""}</div>`;
}

function signatureBlock() {
  return `<section class="signature-block"><div><span>Disahkan oleh Penyelia</span><strong>&nbsp;</strong><small>Nama dan tandatangan</small></div><div><span>Tarikh pengesahan</span><strong>&nbsp;</strong><small>Tarikh</small></div></section>`;
}

function reportFolder(title, itemCount, content) {
  return `<details class="report-folder"><summary><span class="folder-icon" aria-hidden="true"></span><span><strong>${escapeHtml(title)}</strong><small>Klik untuk melihat senarai lengkap.</small></span><b>${escapeHtml(number.format(itemCount))} item</b><i aria-hidden="true">⌄</i></summary><div class="report-folder-content">${content}</div></details>`;
}

function reportDocument(title, meta, body) {
  return `<div class="monthly-document"><header class="print-head"><div class="print-brand">AMO</div><div><small>HOSPITAL KUALA LIPIS · JABATAN KECEMASAN & TRAUMA</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(meta.label)}</p></div><dl><dt>Dijana</dt><dd>${escapeHtml(new Date().toLocaleString("ms-MY", { timeZone:"Asia/Kuala_Lumpur", dateStyle:"medium", timeStyle:"short" }))}</dd><dt>Oleh</dt><dd>${escapeHtml(roleLabel())}</dd></dl></header>${body}${signatureBlock()}<footer>Dashboard Penerima AMO v2 · Ringkasan bulanan</footer></div>`;
}

function procedureNames(row) {
  const values = Array.isArray(row.procedures) ? row.procedures : String(row.procedures || "").split(/[,;·]/);
  return values.map(item => typeof item === "object" && item ? item.name || item.procedure || item.label || item.type : item).map(item => String(item || "").trim()).filter(Boolean);
}

function procedureReport(meta) {
  const rows = monthlyRows(procedure);
  const totals = new Map();
  rows.forEach(row => procedureNames(row).forEach(name => totals.set(name, (totals.get(name) || 0) + 1)));
  const totalProcedures = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const patients = new Set(rows.map(row => String(row.registrationNumber || row.patientId || row.id || "").trim()).filter(Boolean));
  const bodyRows = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ms-MY"));
  const detail = `<section class="report-section"><h2>Ringkasan prosedur</h2><table><thead><tr><th>Prosedur</th><th>Jumlah</th><th>Peratus</th></tr></thead><tbody>${bodyRows.length ? bodyRows.map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${number.format(count)}</td><td>${totalProcedures ? ((count / totalProcedures) * 100).toFixed(1) : "0.0"}%</td></tr>`).join("") : `<tr><td colspan="3" class="print-empty">Tiada prosedur direkodkan bagi bulan ini.</td></tr>`}</tbody><tfoot><tr><th>Jumlah keseluruhan</th><th>${number.format(totalProcedures)}</th><th>100%</th></tr></tfoot></table></section>`;
  return reportDocument("Laporan Bulanan Prosedur", meta, `<section class="report-kpis">${kpi("Jumlah pesakit", number.format(patients.size || rows.length))}${kpi("Jumlah prosedur", number.format(totalProcedures))}${kpi("Jenis prosedur", number.format(totals.size))}</section>${reportFolder("Perincian prosedur bulanan", bodyRows.length, detail)}`);
}

function asthmaReport(meta) {
  const rows = monthlyRows(asthma).sort((a, b) => recordTime(a) - recordTime(b));
  const patients = new Map();
  rows.forEach(row => {
    const key = String(row.patientId || row.patientName || row.id || "Tanpa ID").trim();
    const entry = patients.get(key) || { name:row.patientName || "—", id:row.patientId || "—", type:row.patientType || "—", rows:[] };
    entry.rows.push(row); patients.set(key, entry);
  });
  const complete = rows.filter(row => !row.pefrNotDone && row.categoryBefore && row.categoryAfter).length;
  const notDone = rows.filter(row => row.pefrNotDone || row.incomplete).length;
  const uptriage = rows.filter(row => row.uptriage && !/^(tiada|no|false|-|—)$/i.test(String(row.uptriage).trim())).length;
  const patientRows = [...patients.values()].map(patient => {
    const first = patient.rows[0]; const last = patient.rows.at(-1);
    const completeCount = patient.rows.filter(row => !row.pefrNotDone && row.categoryBefore && row.categoryAfter).length;
    const dateRange = recordDate(first) === recordDate(last) ? recordDate(last) : `${recordDate(first)} – ${recordDate(last)}`;
    return `<tr><td>${escapeHtml(dateRange)}</td><td><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.id)}</small></td><td>${escapeHtml(patient.type)}</td><td>${number.format(patient.rows.length)}</td><td>${escapeHtml(last.categoryBefore || "—")} → ${escapeHtml(last.categoryAfter || "—")}</td><td>${completeCount}/${patient.rows.length}</td><td>${escapeHtml(last.uptriage || "Tiada")}</td></tr>`;
  });
  const detail = `<section class="report-section"><h2>Ringkasan setiap pesakit</h2><table><thead><tr><th>Tarikh</th><th>Pesakit / IC-RN</th><th>Kategori</th><th>Penilaian</th><th>Before → After</th><th>Lengkap</th><th>Uptriage</th></tr></thead><tbody>${patientRows.length ? patientRows.join("") : `<tr><td colspan="7" class="print-empty">Tiada penilaian Asthma direkodkan bagi bulan ini.</td></tr>`}</tbody></table></section>`;
  return reportDocument("Laporan Bulanan Asthma", meta, `<section class="report-kpis">${kpi("Jumlah pesakit", number.format(patients.size))}${kpi("Jumlah penilaian", number.format(rows.length))}${kpi("Before + After lengkap", rows.length ? `${((complete / rows.length) * 100).toFixed(1)}%` : "0.0%", `${complete}/${rows.length}`)}${kpi("PEFR tidak dibuat", number.format(notDone))}${kpi("Uptriage", number.format(uptriage))}</section>${reportFolder("Perincian penilaian bulanan", patientRows.length, detail)}`);
}

function reportStatus(tone, symbol, label) {
  return `<span class="daily-report-status ${escapeHtml(tone)}"><i aria-hidden="true">${escapeHtml(symbol)}</i><span>${escapeHtml(label)}</span></span>`;
}

function monthlyChecklistRows(module) {
  const rows = monthlyRows(module);
  return latestRowsBySlot(rows, row => {
    const date = recordDate(row);
    if (module.id === "phc") return `${date}|${String(row.bag || "beg-tidak-diketahui").trim().toLocaleUpperCase("ms-MY")}`;
    const shift = shiftId(row.shift) || String(row.shift || "tidak-diketahui").trim().toLocaleLowerCase("ms-MY");
    return `${date}|${shift}`;
  }, recordTime);
}

function findingModuleFor(module) {
  return module.id === "phc" ? phcFindings : girnFindings;
}

function monthlyFindingsFor(module, meta) {
  const findingModule = findingModuleFor(module);
  return rowsFor(findingModule).filter(row => recordDate(row).startsWith(meta.value)).sort((a, b) => recordTime(a) - recordTime(b));
}

function findingStatusLabel(row) {
  const status = String(row.state || row.status || "Baharu").trim() || "Baharu";
  return status;
}

function findingSummary(module, row) {
  if (module.id === "phc") {
    const title = row.item || row.type || "Penemuan PHC";
    const detail = [row.bagShift, row.note, row.qty != null && row.standard != null ? `Baki ${row.qty}/${row.standard}` : ""].filter(Boolean).join(" · ");
    return { title, detail };
  }
  const title = row.device || "Penemuan GIRN";
  const detail = [row.inspectionStatus, row.note, row.shift ? `Syif ${row.shift}` : "", row.reporter].filter(Boolean).join(" · ");
  return { title, detail };
}

function findingsDetailSection(module, findings) {
  if (!findings.length) return `<section class="report-section"><h2>Perincian penemuan bulanan</h2><p class="print-empty">Tiada penemuan direkodkan bagi bulan ini.</p></section>`;
  const grouped = new Map();
  findings.forEach(row => {
    const date = recordDate(row) || "Tarikh tidak diketahui";
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(row);
  });
  const blocks = [...grouped.entries()].map(([date, rows]) => {
    const label = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00+08:00`).toLocaleDateString("ms-MY", { day:"numeric", month:"long", year:"numeric", timeZone:"Asia/Kuala_Lumpur" }) : date;
    return `<div class="finding-report-day"><h3>${escapeHtml(label)} · ${number.format(rows.length)} penemuan</h3>${rows.map(row => {
      const summary = findingSummary(module, row);
      return `<div class="finding-report-item"><strong>${escapeHtml(summary.title)}</strong>${summary.detail ? `<span>${escapeHtml(summary.detail)}</span>` : ""}<small>Status: ${escapeHtml(findingStatusLabel(row))}</small></div>`;
    }).join("")}</div>`;
  }).join("");
  return `<section class="report-section finding-report-section"><h2>Perincian penemuan bulanan</h2><p>Hanya tarikh yang mempunyai penemuan disenaraikan di bawah.</p>${blocks}</section>`;
}

function dailyChecklistReport(module, title, meta) {
  const rows = monthlyChecklistRows(module);
  const findings = monthlyFindingsFor(module, meta);
  const findingsByDate = new Map();
  findings.forEach(row => {
    const date = recordDate(row);
    if (!date) return;
    if (!findingsByDate.has(date)) findingsByDate.set(date, []);
    findingsByDate.get(date).push(row);
  });
  const outstandingFindings = findings.filter(row => isOutstanding(findingModuleFor(module), row)).length;
  const acknowledgedOrDone = findings.length - outstandingFindings;
  const { dayStates, reportDays, compliantDays, pendingVerificationDays, missingDays, rate } = buildDailyComplianceSummary(rows, meta, localDateKey(), recordDate);
  const daily = dayStates.map(day => {
    const dateLabel = new Date(`${day.date}T12:00:00+08:00`).toLocaleDateString("ms-MY", { day:"numeric", month:"long", year:"numeric", timeZone:"Asia/Kuala_Lumpur" });
    const checklistStatus = day.completed ? reportStatus("done", "✓", "Dibuat") : reportStatus("missing", "✕", "Tidak dibuat");
    const verificationStatus = day.status === "verified" ? reportStatus("done", "✓", "Disahkan") : day.status === "pending" ? reportStatus("pending", "◷", "Belum disahkan") : reportStatus("neutral", "−", "—");
    const findingCount = findingsByDate.get(day.date)?.length || 0;
    const findingText = findingCount ? `<strong>${number.format(findingCount)} penemuan</strong>` : `<span>Tiada</span>`;
    return `<tr><td><strong>${escapeHtml(dateLabel)}</strong></td><td>${checklistStatus}</td><td>${verificationStatus}</td><td class="record-count">${number.format(day.recordCount)}</td><td>${findingText}</td></tr>`;
  }).join("");
  const emptyRow = `<tr><td colspan="5" class="print-empty">Tiada tarikh untuk dinilai bagi bulan ini.</td></tr>`;
  const dailyDetail = `<section class="report-section daily-section"><h2>Status harian ${escapeHtml(module.label)}</h2><p>Ringkasan checklist, pengesahan penyelia dan jumlah penemuan bagi setiap tarikh.</p><table class="daily-report-table"><thead><tr><th>Tarikh</th><th>Status Checklist</th><th>Status Pengesahan</th><th>Bilangan Rekod</th><th>Penemuan</th></tr></thead><tbody>${daily || emptyRow}</tbody></table><p class="daily-report-legend"><strong>Patuh</strong> = sekurang-kurangnya satu checklist dibuat dan semua rekod pada tarikh tersebut telah disahkan.</p></section>`;
  const findingDetail = findingsDetailSection(module, findings);
  return reportDocument(title, meta, `<section class="report-kpis daily-report-kpis">${kpi("Hari dinilai", number.format(reportDays.length), "Tarikh hingga hari ini", "info")}${kpi("Hari patuh", number.format(compliantDays), "Dibuat dan disahkan", "good")}${kpi("Belum disahkan", number.format(pendingVerificationDays), "Menunggu penyelia", "pending")}${kpi("Tidak dibuat", number.format(missingDays), "Tiada checklist", "missing")}${kpi("Pematuhan", `${rate.toFixed(1)}%`, `${number.format(compliantDays)}/${number.format(reportDays.length)} hari`, "info")}${kpi("Jumlah penemuan", number.format(findings.length), "Dalam bulan dipilih", "info")}${kpi("Belum diambil maklum", number.format(outstandingFindings), "Masih perlukan tindakan", "pending")}${kpi("Diambil maklum / selesai", number.format(acknowledgedOrDone), "Telah diproses", "good")}</section>${reportFolder(`Status harian ${module.label}`, dayStates.length, dailyDetail)}${reportFolder("Perincian penemuan bulanan", findings.length, findingDetail)}`);
}

function phcReport(meta) {
  return dailyChecklistReport(phc, "Laporan Bulanan PHC", meta);
}

function girnReport(meta) {
  return dailyChecklistReport(girn, "Laporan Bulanan GIRN", meta);
}

function generateMonthlyReport() {
  const meta = selectedMonthMeta();
  state.reportMonth = meta.value;
  state.reportHtml = state.active.id === "procedure" ? procedureReport(meta) : state.active.id === "asthma" ? asthmaReport(meta) : state.active.id === "phc" ? phcReport(meta) : girnReport(meta);
  state.reportDirty = false;
  reportPreview.innerHTML = state.reportHtml;
  status.textContent = `Laporan ${state.active.label} · ${meta.label} siap dijana.`;
  printPreviewBtn.disabled = false;
  return state.reportHtml;
}

function openPrintPreview() {
  if (state.reportDirty || !state.reportHtml || state.reportMonth !== selectedMonthMeta().value) generateMonthlyReport();
  document.querySelector("#printReport").innerHTML = state.reportHtml;
  document.querySelectorAll("#printReport .report-folder").forEach(folder => { folder.open = true; });
  document.querySelector("#previewHint").textContent = `${state.active.label} · ${selectedMonthMeta().label}`;
  document.body.classList.add("preview-open");
  requestAnimationFrame(() => printDialog.showModal());
}

function closePrintPreview() { if (printDialog.open) printDialog.close(); document.body.classList.remove("preview-open", "printing"); }
function printReport() {
  document.body.classList.add("printing");
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

primaryModules.forEach(module => {
  const button = document.createElement("button"); button.type = "button"; button.dataset.id = module.id; button.textContent = module.label; button.addEventListener("click", () => selectModule(module)); tabs.append(button);
});
reportMonth.value = localDateKey().slice(0, 7);
reportMonth.addEventListener("change", () => {
  state.reportDirty = true;
  state.reportHtml = "";
  reportPreview.innerHTML = `<p class="empty">Bulan ditukar. Tekan <strong>Jana laporan bulanan</strong>.</p>`;
  status.textContent = "Laporan perlu dijana semula untuk bulan yang dipilih.";
  printPreviewBtn.disabled = true;
});
generateReportBtn.addEventListener("click", generateMonthlyReport);
document.querySelector("#printPreviewBtn").addEventListener("click", openPrintPreview);
document.querySelector("#closePreviewBtn").addEventListener("click", closePrintPreview);
document.querySelector("#printBtn").addEventListener("click", printReport);
printDialog.addEventListener("cancel", event => { event.preventDefault(); closePrintPreview(); });
window.addEventListener("afterprint", () => document.body.classList.remove("printing"));
document.querySelector("#logoutBtn").addEventListener("click", async () => { state.stops.forEach(stop => stop()); await logout(); location.href = "../"; });
selectAllActions.addEventListener("change", () => { const items = actionItems(); selectAllActions.checked ? items.forEach(item => state.selectedActions.add(item.key)) : state.selectedActions.clear(); renderActions(); });
selectAllDailyVerifications.addEventListener("change", () => { state.selectedDailyVerifications = selectAllDailyVerificationKeys(dailyVerificationItems(), selectAllDailyVerifications.checked); renderActions(); });
supervisorFolderToggle.addEventListener("click", () => {
  const opening = supervisorFolderContent.hidden;
  supervisorFolderContent.hidden = !opening;
  supervisorFolderToggle.setAttribute("aria-expanded", String(opening));
  supervisorFolderToggle.querySelector(".folder-label").textContent = opening ? "Tutup" : "Buka";
});
verifySelectedDailyBtn.addEventListener("click", () => verifyDailyVerifications([...state.selectedDailyVerifications]));
ackSelectedBtn.addEventListener("click", () => runSelectedAction("acknowledge"));
verifySelectedBtn.addEventListener("click", () => runSelectedAction("verify"));
window.addEventListener("beforeunload", () => state.stops.forEach(stop => stop()));

await prepareAuth();
const user = await new Promise(resolve => { const stop = onAuthStateChanged(auth, value => { stop(); resolve(value); }); });
const profile = user && !user.isAnonymous ? await getProfile(user.uid).catch(() => null) : null;
if (!user || user.isAnonymous || !isSupervisor(profile)) {
  gate.innerHTML = `<h2>Akses tidak dibenarkan</h2><p>Log masuk di dashboard utama menggunakan akaun admin atau penyelia yang diluluskan.</p><a href="../">Kembali ke dashboard utama</a>`;
} else {
  sessionUser = user; sessionProfile = profile;
  document.querySelector("#userLabel").textContent = `${profile.name || user.displayName || user.email} · ${roleLabel()}`;
  document.querySelector("#supervisorCentre").hidden = false;
  gate.hidden = true; dashboard.hidden = false;
  [...tabs.children].find(button => button.dataset.id === state.active.id)?.classList.add("active");
  renderAll(); startLiveData();
}
