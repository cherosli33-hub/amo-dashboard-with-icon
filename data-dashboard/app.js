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
const actionTaskModule = { id:"supervisor-actions", label:"Tindakan Umum", shortLabel:"UMUM", collection:COLLECTIONS.actionTasks, finding:true, filter:row => row.recordType !== "audit" };
const streams = [...modules, actionTaskModule];
const actionSources = [phc, phcFindings, girnFindings, actionTaskModule];
const state = { active: procedure, data: new Map(), ready: new Set(), errors: new Set(), stops: [], selectedActions:new Set(), acting:false };
const number = new Intl.NumberFormat("ms-MY");
const gate = document.querySelector("#gate");
const dashboard = document.querySelector("#dashboard");
const summary = document.querySelector("#summary");
const tabs = document.querySelector("#tabs");
const tableHead = document.querySelector("#tableHead");
const tableBody = document.querySelector("#tableBody");
const status = document.querySelector("#status");
const connectionState = document.querySelector("#connectionState");
const lastUpdated = document.querySelector("#lastUpdated");
const recentList = document.querySelector("#recentList");
const search = document.querySelector("#searchInput");
const fromDate = document.querySelector("#fromDate");
const toDate = document.querySelector("#toDate");
const actionList = document.querySelector("#actionList");
const actionCount = document.querySelector("#actionCount");
const actionStatus = document.querySelector("#actionStatus");
const selectAllActions = document.querySelector("#selectAllActions");
const ackSelectedBtn = document.querySelector("#ackSelectedBtn");
const verifySelectedBtn = document.querySelector("#verifySelectedBtn");
let sessionUser = null;
let sessionProfile = null;

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function dateObject(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function recordDate(row) {
  if (/^\d{4}-\d{2}-\d{2}/.test(String(row.date || ""))) return String(row.date).slice(0, 10);
  const value = row.submittedAt || row.timestamp || row.savedAt || row.createdAt || row.reportedAt || row.actionAt;
  const parsed = dateObject(value);
  return parsed ? parsed.toLocaleDateString("sv-SE", { timeZone:"Asia/Kuala_Lumpur" }) : "";
}

function recordTime(row) {
  const value = row.submittedAt || row.timestamp || row.savedAt || row.createdAt || row.reportedAt || row.actionAt || (row.date ? `${row.date}T${row.time || "00:00"}:00+08:00` : "");
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
  if (["submittedAt", "savedAt", "timestamp", "reportedAt", "actionAt", "verifiedAt", "acknowledgedAt", "completedAt"].includes(key)) return displayTimestamp(value);
  return value;
}

function rowsFor(module) {
  return state.data.get(module.id) || [];
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

function normalizedStatus(row) {
  return String(row.actionStatus || row.state || row.status || "").trim().toLocaleLowerCase("ms-MY");
}

function isOutstanding(module, row) {
  if (module.id === "phc") return row.verified !== true;
  const done = new Set(["selesai", "telah diambil tindakan", "ditutup", "diambil maklum", "disahkan", "completed", "closed", "acknowledged", "verified"]);
  return !done.has(normalizedStatus(row));
}

function actionKey(module, row) { return `${module.id}:${row.id}`; }

function actionItems() {
  return actionSources.flatMap(module => rowsFor(module)
    .filter(row => isOutstanding(module, row))
    .map(row => ({ module, row, key:actionKey(module, row), time:recordTime(row) })))
    .sort((a, b) => b.time - a.time);
}

function renderSummary() {
  const primaryTotal = primaryModules.reduce((sum, module) => sum + rowsFor(module).length, 0);
  const pendingActions = actionItems().length;
  const metrics = [
    { label:"Jumlah diterima", value:primaryTotal, className:"total" },
    ...primaryModules.map(module => ({ label:module.label, value:rowsFor(module).length })),
    { label:"Perlu tindakan", value:pendingActions, className:"alert" },
    { label:"Penemuan", value:rowsFor(phcFindings).length + rowsFor(girnFindings).length }
  ];
  summary.innerHTML = metrics.map(item => `<article class="metric ${item.className || ""}"><small>${escapeHtml(item.label)}</small><strong>${number.format(item.value)}</strong></article>`).join("");
}

function actionTitleFor(module, row) {
  if (module.id === "phc") return [row.bag, row.shift].filter(Boolean).join(" · ") || "Pemeriksaan PHC";
  if (module.id === "phc-findings") return row.item || row.type || "Penemuan PHC";
  if (module.id === "girn-findings") return row.device || row.inspectionStatus || "Penemuan GIRN";
  return row.title || row.subject || row.type || "Tindakan penyelia";
}

function actionDetailFor(module, row) {
  if (module.id === "phc") return [row.date, row.ppp, "Belum disahkan"].filter(Boolean).join(" · ");
  if (module.id === "phc-findings") return [row.date, row.bagShift, row.type, row.note].filter(Boolean).join(" · ");
  if (module.id === "girn-findings") return [row.date, row.shift, row.inspectionStatus, row.note, row.reporter].filter(Boolean).join(" · ");
  return [recordDate(row), row.module, row.message || row.detail || row.note, row.reporter || row.createdBy].filter(Boolean).join(" · ");
}

function actionBadgeFor(module, row) {
  const required = row.requiredAction || row.actionType;
  if (required) return required;
  if (module.id === "phc") return "PHC · Perlu pengesahan";
  if (module.id === "phc-findings") return "PHC · Perlu tindakan";
  if (module.id === "girn-findings") return "GIRN · Perlu tindakan";
  return "Perlu tindakan";
}

function renderActions() {
  const items = actionItems();
  const existing = new Set(items.map(item => item.key));
  [...state.selectedActions].forEach(key => { if (!existing.has(key)) state.selectedActions.delete(key); });
  actionCount.textContent = number.format(items.length);
  actionList.innerHTML = items.length ? items.map(({ module, row, key }) => `
    <label class="action-item ${state.selectedActions.has(key) ? "selected" : ""}">
      <span class="action-check"><input type="checkbox" data-action-key="${escapeHtml(key)}" ${state.selectedActions.has(key) ? "checked" : ""}></span>
      <span class="action-copy"><strong>${escapeHtml(actionTitleFor(module, row))}</strong><span>${escapeHtml(actionDetailFor(module, row) || "Tiada catatan tambahan")}</span></span>
      <span class="action-badge">${escapeHtml(actionBadgeFor(module, row))}</span>
    </label>`).join("") : `<div class="action-empty">✓ Tiada tindakan penyelia yang tertunggak.</div>`;

  actionList.querySelectorAll("[data-action-key]").forEach(input => input.addEventListener("change", () => {
    if (input.checked) state.selectedActions.add(input.dataset.actionKey);
    else state.selectedActions.delete(input.dataset.actionKey);
    renderActions();
  }));

  const selectedCount = state.selectedActions.size;
  ackSelectedBtn.disabled = state.acting || selectedCount === 0;
  verifySelectedBtn.disabled = state.acting || selectedCount === 0;
  const allSelected = items.length > 0 && items.every(item => state.selectedActions.has(item.key));
  selectAllActions.checked = allSelected;
  selectAllActions.indeterminate = !allSelected && selectedCount > 0;
  selectAllActions.disabled = state.acting || items.length === 0;
}

function selectedActionItems() {
  const selected = state.selectedActions;
  return actionItems().filter(item => selected.has(item.key));
}

function actorName() {
  return sessionProfile?.name || sessionUser?.displayName || sessionUser?.email || "Penyelia";
}

function changesForAction(module, mode) {
  const actor = actorName();
  const email = sessionUser?.email || sessionProfile?.email || "";
  const label = mode === "verify" ? "Disahkan" : "Diambil maklum";
  const common = { action:label, actionBy:actor, actionByEmail:email, actionAt:serverTimestamp() };
  if (module.id === "phc") {
    return { ...common, verified:true, verifiedBy:actor, verifiedEmail:email, verifiedAt:serverTimestamp() };
  }
  if (module.id === "phc-findings") {
    return mode === "verify"
      ? { ...common, status:"Selesai", verifiedBy:actor, verifiedByEmail:email, verifiedAt:serverTimestamp() }
      : { ...common, status:"Selesai", acknowledgedBy:actor, acknowledgedByEmail:email, acknowledgedAt:serverTimestamp() };
  }
  if (module.id === "girn-findings") {
    return mode === "verify"
      ? { ...common, state:"Selesai", verifiedBy:actor, verifiedByEmail:email, verifiedAt:serverTimestamp() }
      : { ...common, state:"Diambil maklum", acknowledgedBy:actor, acknowledgedByEmail:email, acknowledgedAt:serverTimestamp() };
  }
  return { ...common, status:"selesai", state:"selesai", completedBy:actor, completedByEmail:email, completedAt:serverTimestamp() };
}

async function runSelectedAction(mode) {
  const items = selectedActionItems();
  if (!items.length || state.acting) return;
  const verb = mode === "verify" ? "sahkan" : "ambil maklum";
  if (!confirm(`${verb === "sahkan" ? "Sahkan" : "Ambil maklum"} ${items.length} rekod terpilih?`)) return;
  state.acting = true;
  actionStatus.textContent = `Menyimpan tindakan untuk ${items.length} rekod…`;
  renderActions();
  try {
    const chunks = [];
    for (let index = 0; index < items.length; index += 200) chunks.push(items.slice(index, index + 200));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(({ module, row }) => {
        const changes = changesForAction(module, mode);
        batch.update(doc(db, module.collection, row.id), changes);
        batch.set(doc(collection(db, COLLECTIONS.actionTasks)), {
          recordType:"audit",
          status:"completed",
          state:"completed",
          sourceCollection:module.collection,
          sourceId:row.id,
          sourceModule:module.id,
          sourceTitle:actionTitleFor(module, row),
          sourceDetail:actionDetailFor(module, row),
          actionType:mode,
          actionLabel:mode === "verify" ? "Disahkan" : "Diambil maklum",
          actorUid:sessionUser?.uid || "",
          actorName:actorName(),
          actorEmail:sessionUser?.email || sessionProfile?.email || "",
          actorRole:sessionProfile?.role || "",
          actedAt:serverTimestamp()
        });
      });
      await batch.commit();
    }
    state.selectedActions.clear();
    actionStatus.textContent = `${items.length} rekod berjaya ${verb === "sahkan" ? "disahkan" : "diambil maklum"} oleh ${actorName()}.`;
  } catch (error) {
    console.error("Tindakan penyelia gagal", error);
    actionStatus.textContent = error.message || "Tindakan gagal disimpan.";
  } finally {
    state.acting = false;
    renderActions();
  }
}

function recentText(module, row) {
  if (module.id === "procedure") return [row.registrationNumber || "Rekod prosedur", [row.zone, row.shift].filter(Boolean).join(" · ")];
  if (module.id === "asthma") return [row.patientName || row.patientId || "Penilaian asma", [row.categoryBefore, row.categoryAfter].filter(Boolean).join(" → ")];
  if (module.id === "phc") return [[row.bag, row.shift].filter(Boolean).join(" · ") || "Pemeriksaan PHC", row.ppp || ""];
  return [[row.shift, row.officer].filter(Boolean).join(" · ") || "Pemeriksaan GIRN", `${Array.isArray(row.devices) ? row.devices.length : 0} peralatan`];
}

function renderRecent() {
  const items = primaryModules.flatMap(module => rowsFor(module).map(row => ({ module, row, time:recordTime(row) })))
    .sort((a, b) => b.time - a.time).slice(0, 8);
  recentList.innerHTML = items.length ? items.map(({ module, row }) => {
    const [title, detail] = recentText(module, row);
    const date = recordDate(row);
    return `<button class="recent-item" type="button" data-module="${module.id}"><span class="recent-icon">${escapeHtml(module.label.slice(0, 3).toUpperCase())}</span><span class="recent-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml([module.label, date, detail].filter(Boolean).join(" · "))}</span></span></button>`;
  }).join("") : `<p class="empty">Belum ada rekod diterima.</p>`;
  recentList.querySelectorAll("[data-module]").forEach(button => button.addEventListener("click", () => selectModule(modules.find(module => module.id === button.dataset.module))));
}

function renderConnection() {
  if (state.errors.size) {
    connectionState.textContent = `${state.errors.size} aliran gagal disambung`;
    connectionState.className = "error";
  } else if (state.ready.size < streams.length) {
    connectionState.textContent = `Menyambung ${state.ready.size}/${streams.length} aliran…`;
    connectionState.className = "";
  } else {
    connectionState.textContent = "● Semua data langsung";
    connectionState.className = "";
  }
}

function renderAll() {
  renderSummary();
  renderActions();
  renderRecent();
  renderTable();
  renderConnection();
  lastUpdated.textContent = `Dikemas kini ${new Date().toLocaleTimeString("ms-MY", { hour:"2-digit", minute:"2-digit", second:"2-digit" })}`;
}

function selectModule(module) {
  if (!module) return;
  state.active = module;
  [...tabs.children].forEach(button => button.classList.toggle("active", button.dataset.id === module.id));
  renderTable();
  document.querySelector(".data-panel").scrollIntoView({ behavior:"smooth", block:"start" });
}

function startLiveData() {
  streams.forEach(module => {
    const stop = onSnapshot(query(collection(db, module.collection), limit(5000)), snapshot => {
      const rows = snapshot.docs.map(item => ({ id:item.id, ...item.data() }))
        .filter(row => !module.filter || module.filter(row))
        .sort((a, b) => recordTime(b) - recordTime(a));
      state.data.set(module.id, rows);
      state.ready.add(module.id);
      state.errors.delete(module.id);
      renderAll();
    }, error => {
      console.error(`Gagal membaca ${module.collection}`, error);
      state.errors.add(module.id);
      renderConnection();
    });
    state.stops.push(stop);
  });
}

function exportCsv() {
  const rows = filteredRows();
  const columns = state.active.columns;
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [columns.map(([, label]) => quote(label)).join(","), ...rows.map(row => columns.map(([key]) => quote(valueOf(row, key))).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type:"text/csv;charset=utf-8" }));
  link.download = `amo-v2-${state.active.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

modules.forEach(module => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.id = module.id;
  button.textContent = module.label;
  button.addEventListener("click", () => selectModule(module));
  tabs.append(button);
});
[search, fromDate, toDate].forEach(input => input.addEventListener("input", renderTable));
document.querySelector("#resetBtn").addEventListener("click", () => { search.value = ""; fromDate.value = ""; toDate.value = ""; renderTable(); });
document.querySelector("#csvBtn").addEventListener("click", exportCsv);
document.querySelector("#logoutBtn").addEventListener("click", async () => { state.stops.forEach(stop => stop()); await logout(); location.href = "../"; });
selectAllActions.addEventListener("change", () => {
  const items = actionItems();
  if (selectAllActions.checked) items.forEach(item => state.selectedActions.add(item.key));
  else state.selectedActions.clear();
  renderActions();
});
ackSelectedBtn.addEventListener("click", () => runSelectedAction("acknowledge"));
verifySelectedBtn.addEventListener("click", () => runSelectedAction("verify"));
window.addEventListener("beforeunload", () => state.stops.forEach(stop => stop()));

await prepareAuth();
const user = await new Promise(resolve => { const stop = onAuthStateChanged(auth, value => { stop(); resolve(value); }); });
const profile = user && !user.isAnonymous ? await getProfile(user.uid).catch(() => null) : null;
if (!user || user.isAnonymous || !isSupervisor(profile)) {
  gate.innerHTML = `<h2>Akses tidak dibenarkan</h2><p>Log masuk di dashboard utama menggunakan akaun admin atau penyelia yang diluluskan.</p><a href="../">Kembali ke dashboard utama</a>`;
} else {
  sessionUser = user;
  sessionProfile = profile;
  document.querySelector("#userLabel").textContent = `${profile.name || user.displayName || user.email} · ${profile.role === "admin" ? "Admin" : "Penyelia"}`;
  gate.hidden = true;
  dashboard.hidden = false;
  [...tabs.children].find(button => button.dataset.id === state.active.id)?.classList.add("active");
  renderAll();
  startLiveData();
}
