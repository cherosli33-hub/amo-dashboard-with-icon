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
const pefrNotDoneInput = document.querySelector("#pefrNotDone");
const notDoneReasons = document.querySelector("#notDoneReasons");
const notDoneReasonInputs = [...document.querySelectorAll('input[name="notDoneReason"]')];
const notDoneOtherField = document.querySelector("#notDoneOtherField");
const notDoneOtherInput = document.querySelector("#notDoneOther");
const pppNameInput = document.querySelector("#pppName");
const uptriageCard = document.querySelector("#uptriageCard");
const summaryCard = document.querySelector("#summaryCard");
const summaryList = document.querySelector("#summaryList");
const toast = document.querySelector("#toast");
const syncNotice = document.querySelector("#syncNotice");

let assessmentTime = new Date();
let state = { ideal: null, beforePercentage: null, afterPercentage: null };
let pendingRecordId = null;
let activeDateKey = localDateKey();
let formDirty = false;

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

function isPefrNotDone() {
  return pefrNotDoneInput.checked;
}

function selectedNotDoneReason() {
  return notDoneReasonInputs.find(input => input.checked)?.value ?? "";
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
  const needsPefr = !isPefrNotDone();
  adultHeightField.hidden = !isAdult;
  paediatricHeightField.hidden = isAdult;
  adultHeightInput.required = isAdult && needsPefr;
  adultHeightInput.disabled = !isAdult;
  paediatricHeightInput.required = !isAdult && needsPefr;
  paediatricHeightInput.disabled = isAdult;
  ageInput.min = isAdult ? "15" : "0";
  ageInput.max = isAdult ? "85" : "14";
  if (ageInput.value && !ageInput.checkValidity()) ageInput.value = "";
  ageHelp.textContent = isAdult
    ? "Formula dewasa sah untuk umur 15–85 tahun. Rujukan ini tidak meliputi umur 13–14 tahun."
    : "Pediatrik 0–14 tahun; PEFR ideal menggunakan tinggi sahaja.";
  calculateAll();
}

function updateNotDoneMode() {
  const notDone = isPefrNotDone();
  notDoneReasons.hidden = !notDone;
  notDoneReasonInputs.forEach(input => { input.required = notDone; });
  const isOther = notDone && selectedNotDoneReason() === "Others";
  notDoneOtherField.hidden = !isOther;
  notDoneOtherInput.required = isOther;
  beforeInput.required = !notDone;
  afterInput.required = !notDone;
  beforeInput.disabled = notDone;
  afterInput.disabled = notDone;
  if (notDone) {
    beforeInput.value = "";
    afterInput.value = "";
  }
  const isAdult = patientType() === "adult";
  adultHeightInput.required = isAdult && !notDone;
  paediatricHeightInput.required = !isAdult && !notDone;
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
  if (isPefrNotDone()) {
    beforePercent.textContent = "Not Done";
    afterPercent.textContent = "Not Done";
    beforeCategory.textContent = "Tiada bacaan";
    afterCategory.textContent = "Tiada bacaan";
  }
  uptriageCard.hidden = state.afterPercentage === null && !isPefrNotDone();
  summaryCard.hidden = !isPefrNotDone() && (state.beforePercentage === null || state.afterPercentage === null);
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
  if (isPefrNotDone()) {
    const reason = selectedNotDoneReason() || "Belum dipilih";
    const detail = reason === "Others" && notDoneOtherInput.value.trim()
      ? `Others — ${escapeHtml(notDoneOtherInput.value.trim())}`
      : escapeHtml(reason);
    const uptriage = selectedUptriage() === "None" ? "Tiada" : selectedUptriage();
    summaryList.innerHTML = [
      summaryRow("Status PEFR", "Not Done"),
      summaryRow("Sebab", detail),
      summaryRow("Uptriage", uptriage)
    ].join("");
    return;
  }
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

function makeRecord(existingId = null) {
  const data = new FormData(form);
  const beforeClass = classifyPercentage(state.beforePercentage);
  const afterClass = classifyPercentage(state.afterPercentage);
  const notDone = isPefrNotDone();
  return {
    id: existingId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    timestamp: new Date().toISOString(),
    date: localDateKey(assessmentTime),
    time: displayTime(assessmentTime),
    patientType: data.get("patientType"),
    patientName: String(data.get("patientName") || "").trim(),
    patientId: String(data.get("patientId") || "").trim(),
    age: Number(data.get("age")),
    sex: data.get("sex"),
    height: selectedHeight() || null,
    bp: String(data.get("bp") || "").replace(/\s+/g, ""),
    hr: data.get("hr") ? Number(data.get("hr")) : null,
    rr: data.get("rr") ? Number(data.get("rr")) : null,
    temperature: data.get("temperature") ? Number(data.get("temperature")) : null,
    spo2: data.get("spo2") ? Number(data.get("spo2")) : null,
    pefrIdeal: state.ideal,
    pefrBefore: notDone ? null : Number(data.get("pefrBefore")),
    percentageBefore: notDone ? null : state.beforePercentage,
    categoryBefore: notDone ? "Not Done" : beforeClass.label,
    pefrAfter: notDone ? null : Number(data.get("pefrAfter")),
    percentageAfter: notDone ? null : state.afterPercentage,
    categoryAfter: notDone ? "Not Done" : afterClass.label,
    pefrNotDone: notDone,
    notDoneReason: notDone ? selectedNotDoneReason() : "",
    notDoneOther: notDone && selectedNotDoneReason() === "Others" ? notDoneOtherInput.value.trim() : "",
    pppName: String(data.get("pppName") || "").trim(),
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

function upsertLocalRecord(record) {
  const records = getRecords();
  const index = records.findIndex(item => item.id === record.id);
  if (index === -1) records.push(record);
  else records[index] = record;
  putRecords(records);
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
  formDirty = false;
  updatePatientType();
  updateNotDoneMode();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function categoryBadge(category, percentage) {
  if (category === "Not Done" || !Number.isFinite(Number(percentage))) {
    return '<span class="category-badge category-empty">PEFR Not Done</span>';
  }
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
  list.innerHTML = records.map(record => {
    const flow = record.pefrNotDone
      ? `<div class="record-flow"><div><b>PEFR Not Done</b>${categoryBadge("Not Done", null)}</div><span class="arrow">·</span><div><b>Sebab</b><small>${escapeHtml(record.notDoneReason || "Tidak dinyatakan")}${record.notDoneOther ? ` — ${escapeHtml(record.notDoneOther)}` : ""}</small></div></div>`
      : `<div class="record-flow"><div><b>Before · ${record.pefrBefore} L/min</b>${categoryBadge(record.categoryBefore, record.percentageBefore)}</div><span class="arrow">→</span><div><b>After · ${record.pefrAfter} L/min</b>${categoryBadge(record.categoryAfter, record.percentageAfter)}</div></div>`;
    return `<article class="record-card">
      <div class="record-top"><strong>${escapeHtml(record.patientId)}</strong><small>${escapeHtml(record.time)}</small></div>
      ${flow}
      <div class="record-footer"><span>${record.patientType === "adult" ? "Dewasa" : "Pediatrik"}${record.pefrIdeal ? ` · Ideal ${record.pefrIdeal} L/min` : ""}</span><span>PPP: ${escapeHtml(record.pppName || "—")} · Uptriage: ${record.uptriage === "None" ? "Tiada" : escapeHtml(record.uptriage)}</span></div>
    </article>`;
  }).join("");
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
  const notDone = records.filter(record => record.pefrNotDone).length;
  document.querySelector("#statsGrid").innerHTML = [
    ["Jumlah penilaian", records.length],
    ["Dewasa", adults],
    ["Pediatrik", records.length - adults],
    ["Uptriage Yellow", yellow],
    ["Uptriage Red", red],
    ["PEFR Not Done", notDone]
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

function refreshForNewDay() {
  const today = localDateKey();
  if (today === activeDateKey) return;
  activeDateKey = today;
  if (!formDirty) setAssessmentTime(new Date());
  renderRecords();
  renderStats();
}

function scheduleDailyRefresh() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 1, 0);
  window.setTimeout(() => {
    refreshForNewDay();
    scheduleDailyRefresh();
  }, nextMidnight.getTime() - now.getTime());
}

form.addEventListener("input", () => {
  formDirty = true;
  calculateAll();
});
form.addEventListener("change", event => {
  formDirty = true;
  if (event.target.name === "patientType") updatePatientType();
  if (event.target.name === "uptriage") renderSummary();
  if (event.target.name === "pefrNotDone" || event.target.name === "notDoneReason") updateNotDoneMode();
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  const validAssessment = isPefrNotDone()
    ? Boolean(selectedNotDoneReason())
    : Boolean(state.ideal && state.beforePercentage !== null && state.afterPercentage !== null);
  if (!form.reportValidity() || !validAssessment) {
    showToast("Lengkapkan semua maklumat wajib dan bacaan PEFR.");
    return;
  }
  const saveButton = document.querySelector("#saveButton");
  saveButton.disabled = true;
  const record = makeRecord(pendingRecordId);
  upsertLocalRecord(record);
  const hasEndpoint = Boolean(window.ASTHMA_CONFIG?.sheetEndpoint?.trim());
  let synced = false;
  try {
    synced = await syncRecord(record);
  } catch {
    synced = false;
  }
  if (hasEndpoint && !synced) {
    record.syncStatus = "pending";
    pendingRecordId = record.id;
    upsertLocalRecord(record);
    showToast("Gagal menghantar ke Google Sheet. Borang dikekalkan untuk cuba semula.");
    saveButton.disabled = false;
    return;
  }
  if (synced) {
    record.syncStatus = "submitted";
    upsertLocalRecord(record);
  }
  pendingRecordId = null;
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
updateNotDoneMode();
scheduleDailyRefresh();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
