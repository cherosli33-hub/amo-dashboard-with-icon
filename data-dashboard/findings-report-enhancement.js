import { collection, getDocs, limit, query } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "../shared/firebase/core.js";
import { COLLECTIONS } from "../shared/firebase/database.js";

const cache = new Map();

const style = document.createElement("style");
style.textContent = `
.findings-report-addon{margin-top:22px}.findings-report-groups{display:grid;gap:12px}.findings-report-day{break-inside:avoid;padding:14px 16px;border:1px solid #dbe9e4;border-radius:12px;background:#fbfdfc}.findings-report-day>strong{display:block;margin-bottom:9px;color:#174f46}.findings-report-item{padding:8px 0;border-top:1px solid #e6efec}.findings-report-item:first-of-type{border-top:0}.findings-report-item b,.findings-report-item span,.findings-report-item small{display:block}.findings-report-item span{margin-top:3px;color:#48665d}.findings-report-item small{margin-top:4px;color:#70877f}.finding-count-badge{display:inline-flex;align-items:center;justify-content:center;min-width:28px;padding:3px 8px;border-radius:999px;background:#fff3df;color:#9a5d08;font-weight:800}.finding-count-none{color:#6b817a}.findings-kpi{border-color:#ead9b8!important;background:#fffaf1!important}.findings-kpi strong{color:#9a5d08!important}@media print{.findings-report-day{page-break-inside:avoid}.findings-report-addon{page-break-before:auto}}
`;
document.head.appendChild(style);

function activeModuleId() {
  return document.querySelector("#tabs button.active")?.dataset.id || "";
}

function dateKey(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") {
    return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Kuala_Lumpur", year:"numeric", month:"2-digit", day:"2-digit" }).format(value.toDate());
  }
  const raw = String(value).trim();
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Kuala_Lumpur", year:"numeric", month:"2-digit", day:"2-digit" }).format(parsed);
}

function findingDate(row) {
  return dateKey(row.date || row.reportedAt || row.createdAt || row.savedAt || row.timestamp || row.actionAt || row.acknowledgedAt);
}

function normalizedStatus(row) {
  return String(row.actionStatus || row.state || row.status || "Baharu").trim().toLocaleLowerCase("ms-MY");
}

function isAcknowledged(row) {
  if (row.acknowledgedBy || row.verifiedBy || row.completedBy) return true;
  const status = normalizedStatus(row);
  return ["diambil maklum","telah diambil maklum","selesai","ditutup","disahkan","acknowledged","verified","completed","closed"].some(value => status.includes(value));
}

function statusLabel(row) {
  const raw = String(row.state || row.status || row.actionStatus || "Baharu").trim();
  return raw || "Baharu";
}

function findingTitle(moduleId, row) {
  if (moduleId === "phc") {
    const bag = row.bagShift || row.bag || row.shift || "PHC";
    const item = row.item || row.type || "Penemuan";
    return `${bag} · ${item}`;
  }
  return row.device || row.item || "Peralatan GIRN";
}

function findingDetail(moduleId, row) {
  if (row.note) return String(row.note);
  if (moduleId === "phc" && (row.qty != null || row.standard != null)) {
    const qty = row.qty ?? "—";
    const standard = row.standard ?? "—";
    return `Baki ${qty} · Standard ${standard}`;
  }
  return "Tiada catatan tambahan";
}

function findingAction(row) {
  return String(row.action || row.resolution || row.tindakan || "").trim();
}

async function loadFindings(moduleId) {
  const collectionName = moduleId === "phc" ? COLLECTIONS.phcFindings : COLLECTIONS.girnFindings;
  if (cache.has(collectionName)) return cache.get(collectionName);
  const promise = getDocs(query(collection(db, collectionName), limit(5000))).then(snapshot => snapshot.docs.map(item => ({ id:item.id, ...item.data() })));
  cache.set(collectionName, promise);
  return promise;
}

function formatDate(key) {
  return new Date(`${key}T12:00:00+08:00`).toLocaleDateString("ms-MY", { day:"numeric", month:"long", year:"numeric", timeZone:"Asia/Kuala_Lumpur" });
}

function addKpi(container, label, value, note) {
  const kpis = container.querySelector(".report-kpis");
  if (!kpis) return;
  const card = document.createElement("div");
  card.className = "report-kpi findings-kpi findings-report-addon";
  card.innerHTML = `<small>${label}</small><strong>${value}</strong><span>${note}</span>`;
  kpis.appendChild(card);
}

function enhanceDailyTable(container, countsByDate) {
  const table = container.querySelector(".daily-report-table");
  if (!table || table.dataset.findingsEnhanced === "1") return;
  table.dataset.findingsEnhanced = "1";
  const head = table.querySelector("thead tr");
  if (head) {
    const th = document.createElement("th");
    th.textContent = "Penemuan";
    head.appendChild(th);
  }
  table.querySelectorAll("tbody tr").forEach(row => {
    const firstCell = row.querySelector("td");
    if (!firstCell) return;
    if (row.classList.contains("print-empty") || firstCell.classList.contains("print-empty")) {
      firstCell.colSpan = 5;
      return;
    }
    const label = firstCell.textContent.trim();
    const match = [...countsByDate.entries()].find(([key]) => formatDate(key) === label);
    const count = match?.[1] || 0;
    const td = document.createElement("td");
    td.innerHTML = count ? `<span class="finding-count-badge">${count} penemuan</span>` : `<span class="finding-count-none">Tiada</span>`;
    row.appendChild(td);
  });
}

function detailSection(moduleId, findings) {
  const section = document.createElement("section");
  section.className = "report-section findings-report-addon";
  section.innerHTML = `<h2>Perincian Penemuan Bulanan</h2><p>Senarai penemuan mengikut tarikh dalam bulan laporan.</p>`;
  if (!findings.length) {
    section.innerHTML += `<p class="print-empty">Tiada penemuan direkodkan bagi bulan ini.</p>`;
    return section;
  }
  const grouped = new Map();
  findings.forEach(row => {
    const key = findingDate(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  const groups = document.createElement("div");
  groups.className = "findings-report-groups";
  [...grouped.entries()].sort((a,b) => a[0].localeCompare(b[0])).forEach(([key, rows]) => {
    const day = document.createElement("article");
    day.className = "findings-report-day";
    day.innerHTML = `<strong>${formatDate(key)} · ${rows.length} penemuan</strong>`;
    rows.forEach(row => {
      const item = document.createElement("div");
      item.className = "findings-report-item";
      const action = findingAction(row);
      item.innerHTML = `<b>${findingTitle(moduleId, row)}</b><span>${findingDetail(moduleId, row)}</span><small>Status: ${statusLabel(row)}${row.acknowledgedBy ? ` · Diambil maklum oleh ${row.acknowledgedBy}` : ""}${action ? ` · Tindakan: ${action}` : ""}</small>`;
      day.appendChild(item);
    });
    groups.appendChild(day);
  });
  section.appendChild(groups);
  return section;
}

async function enhanceContainer(container, moduleId, month) {
  const documentRoot = container.querySelector(".monthly-document");
  if (!documentRoot || !["phc","girn"].includes(moduleId)) return;
  documentRoot.querySelectorAll(".findings-report-addon").forEach(node => node.remove());
  const table = documentRoot.querySelector(".daily-report-table");
  if (table) {
    table.dataset.findingsEnhanced = "";
    const lastHead = table.querySelector("thead tr th:last-child");
    if (lastHead?.textContent.trim() === "Penemuan") lastHead.remove();
    table.querySelectorAll("tbody tr").forEach(row => {
      const last = row.querySelector("td:last-child");
      if (last && (last.querySelector(".finding-count-badge") || last.querySelector(".finding-count-none"))) last.remove();
    });
  }
  const all = await loadFindings(moduleId);
  const findings = all.filter(row => findingDate(row).startsWith(month));
  const counts = new Map();
  findings.forEach(row => {
    const key = findingDate(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const unacknowledged = findings.filter(row => !isAcknowledged(row)).length;
  const acted = findings.length - unacknowledged;
  addKpi(documentRoot, "Jumlah penemuan", findings.length, "Semua penemuan bulan ini");
  addKpi(documentRoot, "Belum diambil maklum", unacknowledged, "Memerlukan perhatian");
  addKpi(documentRoot, "Diambil maklum / selesai", acted, "Telah diberi tindakan");
  enhanceDailyTable(documentRoot, counts);
  const dailySection = documentRoot.querySelector(".daily-section");
  const details = detailSection(moduleId, findings);
  (dailySection || documentRoot.querySelector(".report-kpis"))?.insertAdjacentElement("afterend", details);
}

async function enhanceCurrent(targetSelector = "#monthlyReportPreview") {
  const moduleId = activeModuleId();
  if (!["phc","girn"].includes(moduleId)) return;
  const month = document.querySelector("#reportMonth")?.value;
  const container = document.querySelector(targetSelector);
  if (!month || !container) return;
  try {
    await enhanceContainer(container, moduleId, month);
  } catch (error) {
    console.error("Gagal menambah penemuan ke laporan bulanan", error);
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest?.("button");
  if (!button) return;
  if (button.id === "generateReportBtn") setTimeout(() => { void enhanceCurrent(); }, 0);
  if (button.id === "printPreviewBtn") setTimeout(() => { void enhanceCurrent("#printReport"); }, 0);
}, true);

document.querySelector("#reportMonth")?.addEventListener("change", () => cache.clear());
