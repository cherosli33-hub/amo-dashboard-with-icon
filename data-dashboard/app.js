import { collection, getDocs, limit, query } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth, db } from "../shared/firebase/core.js";
import { logout, prepareAuth } from "../shared/firebase/auth.js";
import { getProfile, isSupervisor } from "../shared/firebase/users.js";
import procedure from "./modules/procedure.js";
import asthma from "./modules/asthma.js";
import phc from "./modules/phc.js";
import girn from "./modules/girn.js";

const modules = [procedure, asthma, phc, girn];
const state = { active: procedure, rows: [], cache: new Map() };
const gate = document.querySelector("#gate");
const dashboard = document.querySelector("#dashboard");
const summary = document.querySelector("#summary");
const tabs = document.querySelector("#tabs");
const tableHead = document.querySelector("#tableHead");
const tableBody = document.querySelector("#tableBody");
const status = document.querySelector("#status");
const search = document.querySelector("#searchInput");

function valueOf(row, key) {
  const value = row[key];
  if (Array.isArray(value)) return value.map(item => typeof item === "object" ? (item.name ? `${item.name}${item.status ? `: ${item.status}` : ""}` : JSON.stringify(item)) : item).join(" · ");
  if (value && typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return value ?? "";
}

async function readModule(module, force = false) {
  if (!force && state.cache.has(module.id)) return state.cache.get(module.id);
  const snap = await getDocs(query(collection(db, module.collection), limit(5000)));
  const rows = snap.docs.map(item => ({ id:item.id, ...item.data() })).sort((a,b) => String(b.date || b.submittedAt || b.savedAt || "").localeCompare(String(a.date || a.submittedAt || a.savedAt || "")));
  state.cache.set(module.id, rows);
  return rows;
}

function renderTable() {
  const term = search.value.trim().toLocaleLowerCase("ms-MY");
  const rows = term ? state.rows.filter(row => JSON.stringify(row).toLocaleLowerCase("ms-MY").includes(term)) : state.rows;
  tableHead.innerHTML = `<tr>${state.active.columns.map(([,label]) => `<th>${label}</th>`).join("")}</tr>`;
  tableBody.innerHTML = rows.slice(0,1000).map(row => `<tr>${state.active.columns.map(([key]) => `<td class="${["procedures","devices","notes"].includes(key)?"long":""}">${escapeHtml(valueOf(row,key))}</td>`).join("")}</tr>`).join("");
  status.textContent = `${rows.length} rekod ${state.active.label}${rows.length > 1000 ? " · 1,000 baris pertama dipaparkan" : ""}`;
}

function escapeHtml(value) { const node=document.createElement("div"); node.textContent=String(value); return node.innerHTML; }

async function selectModule(module, force = false) {
  state.active = module;
  [...tabs.children].forEach(button => button.classList.toggle("active", button.dataset.id === module.id));
  status.textContent = `Memuatkan ${module.label}…`;
  state.rows = await readModule(module, force);
  renderTable();
}

async function renderSummary() {
  const counts = await Promise.all(modules.map(async module => [module, (await readModule(module)).length]));
  summary.innerHTML = counts.map(([module,count]) => `<article class="metric"><small>${module.label}</small><strong>${count}</strong></article>`).join("");
}

function exportCsv() {
  const columns = state.active.columns;
  const quote = value => `"${String(value).replaceAll('"','""')}"`;
  const csv = [columns.map(([,label]) => quote(label)).join(","), ...state.rows.map(row => columns.map(([key]) => quote(valueOf(row,key))).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));
  link.download = `amo-v2-${state.active.id}-${new Date().toISOString().slice(0,10)}.csv`;
  link.click(); URL.revokeObjectURL(link.href);
}

modules.forEach(module => { const button=document.createElement("button"); button.type="button"; button.dataset.id=module.id; button.textContent=module.label; button.addEventListener("click",()=>selectModule(module)); tabs.append(button); });
search.addEventListener("input",renderTable);
document.querySelector("#refreshBtn").addEventListener("click",async()=>{state.cache.clear();await renderSummary();await selectModule(state.active,true);});
document.querySelector("#csvBtn").addEventListener("click",exportCsv);
document.querySelector("#logoutBtn").addEventListener("click",async()=>{await logout();location.href="../";});

await prepareAuth();
const user = await new Promise(resolve => { const stop=onAuthStateChanged(auth,value=>{stop();resolve(value);}); });
const profile = user && !user.isAnonymous ? await getProfile(user.uid).catch(()=>null) : null;
if (!user || user.isAnonymous || !isSupervisor(profile)) {
  gate.innerHTML = `<h2>Akses tidak dibenarkan</h2><p>Log masuk di dashboard utama menggunakan akaun admin atau penyelia yang diluluskan.</p><a href="../">Kembali ke dashboard utama</a>`;
} else {
  gate.hidden = true; dashboard.hidden = false;
  await renderSummary(); await selectModule(procedure);
}
