import { collection, limit, onSnapshot, query } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth, db } from "../shared/firebase/core.js";
import { logout, prepareAuth } from "../shared/firebase/auth.js";
import { getProfile, isSupervisor } from "../shared/firebase/users.js";
import procedure from "./modules/procedure.js";
import asthma from "./modules/asthma.js";
import phc from "./modules/phc.js";
import girn from "./modules/girn.js";
import phcFindings from "./modules/phc-findings.js";
import girnFindings from "./modules/girn-findings.js";

const primaryModules = [procedure, asthma, phc, girn];
const modules = [...primaryModules, phcFindings, girnFindings];
const state = { active: procedure, data: new Map(), ready: new Set(), errors: new Set(), stops: [] };
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

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value);
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
  const value = row.submittedAt || row.timestamp || row.savedAt || row.createdAt || row.reportedAt;
  const parsed = dateObject(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
}

function recordTime(row) {
  const value = row.submittedAt || row.timestamp || row.savedAt || row.createdAt || row.reportedAt || (row.date ? `${row.date}T${row.time || "00:00"}:00+08:00` : "");
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
  if (["submittedAt", "savedAt", "timestamp", "reportedAt", "actionAt", "verifiedAt"].includes(key)) return displayTimestamp(value);
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

function outstanding(module) {
  return rowsFor(module).filter(row => !["selesai", "telah diambil tindakan", "ditutup"].includes(String(row.state || row.status || "").toLocaleLowerCase("ms-MY"))).length;
}

function renderSummary() {
  const primaryTotal = primaryModules.reduce((sum, module) => sum + rowsFor(module).length, 0);
  const metrics = [
    { label:"Jumlah diterima", value:primaryTotal, className:"total" },
    ...primaryModules.map(module => ({ label:module.label, value:rowsFor(module).length })),
    { label:"Tindakan PHC", value:outstanding(phcFindings), className:"alert" },
    { label:"Tindakan GIRN", value:outstanding(girnFindings), className:"alert" }
  ];
  summary.innerHTML = metrics.map(item => `<article class="metric ${item.className || ""}"><small>${escapeHtml(item.label)}</small><strong>${number.format(item.value)}</strong></article>`).join("");
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
  } else if (state.ready.size < modules.length) {
    connectionState.textContent = `Menyambung ${state.ready.size}/${modules.length} aliran…`;
    connectionState.className = "";
  } else {
    connectionState.textContent = "● Semua data langsung";
    connectionState.className = "";
  }
}

function renderAll() {
  renderSummary();
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
  modules.forEach(module => {
    const stop = onSnapshot(query(collection(db, module.collection), limit(5000)), snapshot => {
      const rows = snapshot.docs.map(item => ({ id:item.id, ...item.data() })).sort((a, b) => recordTime(b) - recordTime(a));
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
window.addEventListener("beforeunload", () => state.stops.forEach(stop => stop()));

await prepareAuth();
const user = await new Promise(resolve => { const stop = onAuthStateChanged(auth, value => { stop(); resolve(value); }); });
const profile = user && !user.isAnonymous ? await getProfile(user.uid).catch(() => null) : null;
if (!user || user.isAnonymous || !isSupervisor(profile)) {
  gate.innerHTML = `<h2>Akses tidak dibenarkan</h2><p>Log masuk di dashboard utama menggunakan akaun admin atau penyelia yang diluluskan.</p><a href="../">Kembali ke dashboard utama</a>`;
} else {
  document.querySelector("#userLabel").textContent = `${profile.name || user.displayName || user.email} · ${profile.role === "admin" ? "Admin" : "Penyelia"}`;
  gate.hidden = true;
  dashboard.hidden = false;
  [...tabs.children].find(button => button.dataset.id === state.active.id)?.classList.add("active");
  renderAll();
  startLiveData();
}
