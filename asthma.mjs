import {
  PAEDIATRIC_PEFR,
  predictedAdultPef,
  predictedPaediatricPef,
  pefrPercentage,
  classifyPercentage
} from "./pefr.mjs";

const STORAGE_KEY = "amo-etd-asthma-assessments-v1";
const form = document.querySelector("#assessmentForm");
const patientTypeInputs = [...document.querySelectorAll('input[name="patientType"]')];
const uptriageInputs = [...document.querySelectorAll('input[name="uptriage"]')];
const ageInput = document.querySelector("#age");
const ageHelp = document.querySelector("#ageHelp");
const sexInput = document.querySelector("#sex");
const adultHeightField = document.querySelector("#adultHeightField");
const adultHeightInput = document.querySelector("#heightAdult");
const paediatricHeightField = document.querySelector("#paediatricHeightField");
const paediatricHeightInput = document.querySelector("#heightPaediatric");
const beforeInput = document.querySelector("#pefrBefore");
const afterInput = document.querySelector("#pefrAfter");
const idealValue = document.querySelector("#idealValue");
const idealMethod = document.querySelector("#idealMethod");
const beforePercent = document.querySelector("#beforePercent");
const afterPercent = document.querySelector("#afterPercent");
const beforeCategory = document.querySelector("#beforeCategory");
const afterCategory = document.querySelector("#afterCategory");
const uptriageCard = document.querySelector("#uptriageCard");
const summaryCard = document.querySelector("#summaryCard");
const summaryList = document.querySelector("#summaryList");
const toast = document.querySelector("#toast");
const syncNotice = document.querySelector("#syncNotice");

let assessmentTime = new Date();
let state = { ideal: null, beforePercentage: null, afterPercentage: null };

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(date = new Date()) {
  return new Intl.DateTimeFormat("ms-MY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function displayTime(date = new Date()) {
  return new Intl.DateTimeFormat("ms-MY", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function setAssessmentTime(date = new Date()) {
  assessmentTime = date;
  document.querySelector("#displayDate").value = displayDate(date);
  document.querySelector("#displayTime").value = displayTime(date);
}

function patientType() {
  return patientTypeInputs.find(input => input.checked)?.value ?? "adult";
}

function selectedHeight() {
  return patientType() === "adult" ? Number(adultHeightInput.value) : Number(paediatricHeightInput.value);
}

function populatePaediatricHeights() {
  Object.entries(PAEDIATRIC_PEFR).forEach(([height, pefr]) => {
    const option = document.createElement("option");
    option.value = height;
    option.textContent = `${height} cm — ${pefr} L/min`;
    paediatricHeightInput.append(option);
  });
}

function setCategory(element, category) {
  element.className = "category-badge";
  if (!category) {
    element.classList.add("category-empty");
    element.textContent = "Belum dikira";
    return;
  }
  element.classList.add(`category-${category.key}`);
  element.textContent = `${category.label} (${category.range})`;
}

function updatePatientType() {
  const isAdult = patientType() === "adult";
  adultHeightField.hidden = !isAdult;
  paediatricHeightField.hidden = isAdult;
  adultHeightInput.required = isAdult;
  adultHeightInput.disabled = !isAdult;
  paediatricHeightInput.required = !isAdult;
  paediatricHeightInput.disabled = isAdult;
  ageInput.min = isAdult ? "15" : "0";
  ageInput.max = isAdult ? "85" : "14";
  if (ageInput.value && !ageInput.checkValidity()) ageInput.value = "";
  ageHelp.textContent = isAdult
    ? "Formula dewasa sah untuk umur 15–85 tahun. Rujukan ini tidak meliputi umur 13–14 tahun."
    : "Pediatrik 0–14 tahun; PEFR ideal menggunakan tinggi sahaja.";
  calculateAll();
}

function calculateIdeal() {
  if (patientType() === "adult") {
    state.ideal = predictedAdultPef({ age: ageInput.value, sex: sexInput.value, heightCm: adultHeightInput.value });
    idealMethod.textContent = state.ideal
      ? "Nunn–Gregg (umur, jantina, tinggi), ditukar kepada skala EU/EN13826."
      : "Dewasa memerlukan umur 15–85 tahun, jantina dan tinggi.";
  } else {
    state.ideal = predictedPaediatricPef(paediatricHeightInput.value);
    idealMethod.textContent = state.ideal
      ? "Nilai tepat jadual pediatrik EU/EN13826 berdasarkan tinggi."
      : "Pilih tinggi rujukan pediatrik 85–170 cm.";
  }
  idealValue.textContent = state.ideal ? `${state.ideal} L/min` : "— L/min";
}

function calculateResults() {
  state.beforePercentage = pefrPercentage(beforeInput.value, state.ideal);
  state.afterPercentage = pefrPercentage(afterInput.value, state.ideal);
  const beforeClass = classifyPercentage(state.beforePercentage);
  const afterClass = classifyPercentage(state.afterPercentage);
  beforePercent.textContent = state.beforePercentage === null ? "—%" : `${state.beforePercentage.toFixed(1)}%`;
  afterPercent.textContent = state.afterPercentage === null ? "—%" : `${state.afterPercentage.toFixed(1)}%`;
  setCategory(beforeCategory, beforeClass);
  setCategory(afterCategory, afterClass);
  uptriageCard.hidden = state.afterPercentage === null;
  summaryCard.hidden = state.beforePercentage === null || state.afterPercentage === null;
  renderSummary();
}

function calculateAll() {
  calculateIdeal();
  calculateResults();
}

function summaryRow(label, value) {
  return `<div class="summary-row"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function selectedUptriage() {
  return uptriageInputs.find(input => input.checked)?.value ?? "None";
}

function renderSummary() {
  if (summaryCard.hidden) return;
  const beforeClass = classifyPercentage(state.beforePercentage);
  const afterClass = classifyPercentage(state.afterPercentage);
  const uptriage = selectedUptriage() === "None" ? "Tiada" : selectedUptriage();
  summaryList.innerHTML = [
    summaryRow("PEFR Ideal", `${state.ideal} L/min`),
    summaryRow("PEFR Before", `${Number(beforeInput.value)} L/min · ${state.beforePercentage.toFixed(1)}% · ${beforeClass.label}`),
    summaryRow("PEFR After", `${Number(afterInput.value)} L/min · ${state.afterPercentage.toFixed(1)}% · ${afterClass.label}`),
    summaryRow("Uptriage", uptriage)
  ].join("");
}

function getRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function putRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function makeRecord() {
  const data = new FormData(form);
  const beforeClass = classifyPercentage(state.beforePercentage);
  const afterClass = classifyPercentage(state.afterPercentage);
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    date: localDateKey(assessmentTime),
    time: displayTime(assessmentTime),
    patientType: data.get("patientType"),
    patientName: String(data.get("patientName") || "").trim(),
    patientId: String(data.get("patientId") || "").trim(),
    age: Number(data.get("age")),
    sex: data.get("sex"),
    height: selectedHeight(),
    bpSys: data.get("bpSys") ? Number(data.get("bpSys")) : null,
    bpDia: data.get("bpDia") ? Number(data.get("bpDia")) : null,
    hr: data.get("hr") ? Number(data.get("hr")) : null,
    rr: data.get("rr") ? Number(data.get("rr")) : null,
    temperature: data.get("temperature") ? Number(data.get("temperature")) : null,
    spo2: data.get("spo2") ? Number(data.get("spo2")) : null,
    pefrIdeal: state.ideal,
    pefrBefore: Number(data.get("pefrBefore")),
    percentageBefore: state.beforePercentage,
    categoryBefore: beforeClass.label,
    pefrAfter: Number(data.get("pefrAfter")),
    percentageAfter: state.afterPercentage,
    categoryAfter: afterClass.label,
    uptriage: selectedUptriage(),
    syncStatus: window.ASTHMA_CONFIG?.sheetEndpoint ? "pending" : "local"
  };
}

async function syncRecord(record) {
  const endpoint = window.ASTHMA_CONFIG?.sheetEndpoint?.trim();
  if (!endpoint) return false;
  await fetch(endpoint, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "saveAsthmaAssessment", record })
  });
  return true;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function resetForm() {
  form.reset();
  document.querySelector('input[name="patientType"][value="adult"]').checked = true;
  document.querySelector('input[name="uptriage"][value="None"]').checked = true;
  setAssessmentTime(new Date());
  state = { ideal: null, beforePercentage: null, afterPercentage: null };
  updatePatientType();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function categoryBadge(category, percentage) {
  const klass = category.toLowerCase();
  return `<span class="category-badge category-${klass}">${percentage.toFixed(1)}% · ${category}</span>`;
}

function renderRecords() {
  const list = document.querySelector("#recordList");
  const query = document.querySelector("#recordSearch").value.trim().toLowerCase();
  const records = getRecords()
    .filter(record => record.date === localDateKey())
    .filter(record => !query || record.patientId.toLowerCase().includes(query))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (!records.length) {
    list.innerHTML = '<div class="empty-state">Tiada rekod penilaian untuk dipaparkan.</div>';
    return;
  }
  list.innerHTML = records.map(record => `
    <article class="record-card">
      <div class="record-top"><strong>${escapeHtml(record.patientId)}</strong><small>${escapeHtml(record.time)}</small></div>
      <div class="record-flow">
        <div><b>Before · ${record.pefrBefore} L/min</b>${categoryBadge(record.categoryBefore, record.percentageBefore)}</div>
        <span class="arrow">→</span>
        <div><b>After · ${record.pefrAfter} L/min</b>${categoryBadge(record.categoryAfter, record.percentageAfter)}</div>
      </div>
      <div class="record-footer"><span>${record.patientType === "adult" ? "Dewasa" : "Pediatrik"} · Ideal ${record.pefrIdeal} L/min</span><span>Uptriage: ${record.uptriage === "None" ? "Tiada" : escapeHtml(record.uptriage)}</span></div>
    </article>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = (result.getDay() + 6) % 7;
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - day);
  return result;
}

function recordsForRange(range) {
  const now = new Date();
  const today = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return getRecords().filter(record => {
    if (range === "all") return true;
    if (range === "today") return record.date === today;
    if (range === "yesterday") return record.date === localDateKey(yesterday);
    const recordDate = new Date(`${record.date}T00:00:00`);
    if (range === "week") return recordDate >= startOfWeek(now);
    return recordDate.getMonth() === now.getMonth() && recordDate.getFullYear() === now.getFullYear();
  });
}

function countCategory(records, field, value) {
  return records.filter(record => record[field] === value).length;
}

function renderBars(target, records, field) {
  const maximum = Math.max(records.length, 1);
  target.innerHTML = ["Mild", "Moderate", "Severe"].map(category => {
    const count = countCategory(records, field, category);
    return `<div class="bar-row"><span>${category}</span><div class="bar-track"><div class="bar bar-${category.toLowerCase()}" style="width:${(count / maximum) * 100}%"></div></div><b>${count}</b></div>`;
  }).join("");
}

function renderStats() {
  const records = recordsForRange(document.querySelector("#statsRange").value);
  const adults = records.filter(record => record.patientType === "adult").length;
  const yellow = records.filter(record => record.uptriage === "Yellow Zone").length;
  const red = records.filter(record => record.uptriage === "Red Zone").length;
  document.querySelector("#statsGrid").innerHTML = [
    ["Jumlah penilaian", records.length],
    ["Dewasa", adults],
    ["Pediatrik", records.length - adults],
    ["Uptriage Yellow", yellow],
    ["Uptriage Red", red]
  ].map(([label, value]) => `<div class="stat-card"><small>${label}</small><strong>${value}</strong></div>`).join("");
  renderBars(document.querySelector("#beforeBars"), records, "categoryBefore");
  renderBars(document.querySelector("#afterBars"), records, "categoryAfter");
}

function setView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("is-active", view.id === viewId));
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("is-active", button.dataset.view === viewId));
  if (viewId === "todayView") renderRecords();
  if (viewId === "statsView") renderStats();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

form.addEventListener("input", calculateAll);
form.addEventListener("change", event => {
  if (event.target.name === "patientType") updatePatientType();
  if (event.target.name === "uptriage") renderSummary();
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!form.reportValidity() || !state.ideal || state.beforePercentage === null || state.afterPercentage === null) {
    showToast("Lengkapkan semua maklumat wajib dan bacaan PEFR.");
    return;
  }
  const saveButton = document.querySelector("#saveButton");
  saveButton.disabled = true;
  const record = makeRecord();
  const records = getRecords();
  records.push(record);
  putRecords(records);
  let synced = false;
  try {
    synced = await syncRecord(record);
  } catch {
    synced = false;
  }
  showToast(synced ? "Rekod disimpan dan dihantar ke Google Sheet." : "Rekod disimpan pada peranti ini.");
  saveButton.disabled = false;
  resetForm();
});

document.querySelector("#resetButton").addEventListener("click", resetForm);
document.querySelector("#recordSearch").addEventListener("input", renderRecords);
document.querySelector("#clearRecords").addEventListener("click", () => {
  if (!confirm("Padam semua rekod yang disimpan pada peranti ini?")) return;
  localStorage.removeItem(STORAGE_KEY);
  renderRecords();
  showToast("Semua rekod peranti telah dipadam.");
});
document.querySelector("#statsRange").addEventListener("change", renderStats);
document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));

const referenceDialog = document.querySelector("#referenceDialog");
document.querySelectorAll(".reference-card").forEach(button => button.addEventListener("click", () => {
  document.querySelector("#dialogTitle").textContent = button.dataset.title;
  document.querySelector("#dialogImage").src = button.dataset.image;
  document.querySelector("#dialogImage").alt = button.dataset.title;
  referenceDialog.showModal();
}));
document.querySelector("#dialogClose").addEventListener("click", () => referenceDialog.close());
referenceDialog.addEventListener("click", event => { if (event.target === referenceDialog) referenceDialog.close(); });

populatePaediatricHeights();
setAssessmentTime();
syncNotice.hidden = Boolean(window.ASTHMA_CONFIG?.sheetEndpoint?.trim());
updatePatientType();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
