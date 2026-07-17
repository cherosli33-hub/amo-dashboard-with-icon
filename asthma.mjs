import { PAEDIATRIC_PEFR, predictedAdultPef, predictedPaediatricPef, pefrPercentage, classifyPercentage } from "./pefr.mjs";

const PENDING_KEY = "amo-etd-asthma-pending-v2";
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
const uptriageCard = document.querySelector("#uptriageCard");
const summaryCard = document.querySelector("#summaryCard");
const summaryList = document.querySelector("#summaryList");
const toast = document.querySelector("#toast");
const syncNotice = document.querySelector("#syncNotice");

let assessmentTime = new Date();
let state = { ideal: null, beforePercentage: null, afterPercentage: null };
let sharedRecords = [];
let formDirty = false;

function endpoint() { return window.ASTHMA_CONFIG?.sheetEndpoint?.trim() || ""; }
function requestTimeout() { return Number(window.ASTHMA_CONFIG?.requestTimeoutMs) || 15000; }
function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function displayDate(date = new Date()) { return new Intl.DateTimeFormat("ms-MY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date); }
function displayTime(date = new Date()) { return new Intl.DateTimeFormat("ms-MY", { hour: "2-digit", minute: "2-digit" }).format(date); }
function setAssessmentTime(date = new Date()) {
  assessmentTime = date;
  document.querySelector("#displayDate").value = displayDate(date);
  document.querySelector("#displayTime").value = displayTime(date);
}
function patientType() { return patientTypeInputs.find(input => input.checked)?.value ?? "adult"; }
function selectedHeight() { return patientType() === "adult" ? Number(adultHeightInput.value) : Number(paediatricHeightInput.value); }
function isPefrNotDone() { return pefrNotDoneInput.checked; }
function selectedNotDoneReason() { return notDoneReasonInputs.find(input => input.checked)?.value ?? ""; }
function selectedUptriage() { return uptriageInputs.find(input => input.checked)?.value ?? "None"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }

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
  const adult = patientType() === "adult";
  const needsPefr = !isPefrNotDone();
  adultHeightField.hidden = !adult;
  paediatricHeightField.hidden = adult;
  adultHeightInput.required = adult && needsPefr;
  adultHeightInput.disabled = !adult;
  paediatricHeightInput.required = !adult && needsPefr;
  paediatricHeightInput.disabled = adult;
  ageInput.min = adult ? "15" : "0";
  ageInput.max = adult ? "85" : "14";
  ageHelp.textContent = adult ? "Formula dewasa sah untuk umur 15–85 tahun." : "Pediatrik 0–14 tahun; PEFR ideal menggunakan tinggi sahaja.";
  calculateAll();
}
function updateNotDoneMode() {
  const notDone = isPefrNotDone();
  notDoneReasons.hidden = !notDone;
  notDoneReasonInputs.forEach(input => { input.required = notDone; });
  const other = notDone && selectedNotDoneReason() === "Others";
  notDoneOtherField.hidden = !other;
  notDoneOtherInput.required = other;
  beforeInput.required = !notDone;
  afterInput.required = !notDone;
  beforeInput.disabled = notDone;
  afterInput.disabled = notDone;
  if (notDone) { beforeInput.value = ""; afterInput.value = ""; }
  updatePatientType();
}
function calculateIdeal() {
  if (patientType() === "adult") {
    state.ideal = predictedAdultPef({ age: ageInput.value, sex: sexInput.value, heightCm: adultHeightInput.value });
    idealMethod.textContent = state.ideal ? "Nunn–Gregg, ditukar kepada skala EU/EN13826." : "Lengkapkan umur, jantina dan tinggi.";
  } else {
    state.ideal = predictedPaediatricPef(paediatricHeightInput.value);
    idealMethod.textContent = state.ideal ? "Nilai jadual pediatrik berdasarkan tinggi." : "Pilih tinggi rujukan pediatrik.";
  }
  idealValue.textContent = state.ideal ? `${state.ideal} L/min` : "— L/min";
}
function calculateResults() {
  state.beforePercentage = pefrPercentage(beforeInput.value, state.ideal);
  state.afterPercentage = pefrPercentage(afterInput.value, state.ideal);
  setCategory(beforeCategory, classifyPercentage(state.beforePercentage));
  setCategory(afterCategory, classifyPercentage(state.afterPercentage));
  beforePercent.textContent = state.beforePercentage === null ? "—%" : `${state.beforePercentage.toFixed(1)}%`;
  afterPercent.textContent = state.afterPercentage === null ? "—%" : `${state.afterPercentage.toFixed(1)}%`;
  if (isPefrNotDone()) {
    beforePercent.textContent = "Not Done";
    afterPercent.textContent = "Not Done";
    beforeCategory.className = afterCategory.className = "category-badge category-empty";
    beforeCategory.textContent = afterCategory.textContent = "Tiada bacaan";
  }
  uptriageCard.hidden = state.afterPercentage === null && !isPefrNotDone();
  summaryCard.hidden = !isPefrNotDone() && (state.beforePercentage === null || state.afterPercentage === null);
  renderSummary();
}
function calculateAll() { calculateIdeal(); calculateResults(); }
function summaryRow(label, value) { return `<div class="summary-row"><dt>${label}</dt><dd>${value}</dd></div>`; }
function renderSummary() {
  if (summaryCard.hidden) return;
  const uptriage = selectedUptriage() === "None" ? "Tiada" : selectedUptriage();
  if (isPefrNotDone()) {
    const reason = selectedNotDoneReason() || "Belum dipilih";
    const detail = reason === "Others" && notDoneOtherInput.value.trim() ? `Others — ${escapeHtml(notDoneOtherInput.value.trim())}` : escapeHtml(reason);
    summaryList.innerHTML = [summaryRow("Status PEFR", "Not Done"), summaryRow("Sebab", detail), summaryRow("Uptriage", uptriage)].join("");
    return;
  }
  summaryList.innerHTML = [
    summaryRow("PEFR Ideal", `${state.ideal} L/min`),
    summaryRow("PEFR Before", `${Number(beforeInput.value)} L/min · ${state.beforePercentage.toFixed(1)}% · ${classifyPercentage(state.beforePercentage).label}`),
    summaryRow("PEFR After", `${Number(afterInput.value)} L/min · ${state.afterPercentage.toFixed(1)}% · ${classifyPercentage(state.afterPercentage).label}`),
    summaryRow("Uptriage", uptriage)
  ].join("");
}

function getPending() {
  try { const value = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function setPending(records) { localStorage.setItem(PENDING_KEY, JSON.stringify(records)); }
function addPending(record) { const records = getPending().filter(item => item.id !== record.id); records.push(record); setPending(records); }
function removePending(id) { setPending(getPending().filter(item => item.id !== id)); }

function makeRecord() {
  const data = new FormData(form);
  const notDone = isPefrNotDone();
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
    height: selectedHeight() || null,
    bpSys: data.get("bpSys") ? Number(data.get("bpSys")) : null,
    bpDia: data.get("bpDia") ? Number(data.get("bpDia")) : null,
    bp: data.get("bpSys") && data.get("bpDia") ? `${data.get("bpSys")}/${data.get("bpDia")}` : "",
    hr: data.get("hr") ? Number(data.get("hr")) : null,
    rr: data.get("rr") ? Number(data.get("rr")) : null,
    temperature: data.get("temperature") ? Number(data.get("temperature")) : null,
    spo2: data.get("spo2") ? Number(data.get("spo2")) : null,
    pefrIdeal: state.ideal,
    pefrBefore: notDone ? null : Number(data.get("pefrBefore")),
    percentageBefore: notDone ? null : state.beforePercentage,
    categoryBefore: notDone ? "Not Done" : classifyPercentage(state.beforePercentage).label,
    pefrAfter: notDone ? null : Number(data.get("pefrAfter")),
    percentageAfter: notDone ? null : state.afterPercentage,
    categoryAfter: notDone ? "Not Done" : classifyPercentage(state.afterPercentage).label,
    pefrNotDone: notDone,
    notDoneReason: notDone ? selectedNotDoneReason() : "",
    notDoneOther: notDone && selectedNotDoneReason() === "Others" ? notDoneOtherInput.value.trim() : "",
    pppName: String(data.get("pppName") || "").trim(),
    uptriage: selectedUptriage()
  };
}

function sheetRequest(action, { method = "GET", record = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!endpoint()) { reject(new Error("Google Sheet belum disambungkan.")); return; }
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.name = `asthma-sheet-${requestId}`;
    iframe.setAttribute("aria-hidden", "true");
    let formElement = null;
    const timeout = window.setTimeout(() => cleanup(new Error("Masa sambungan Google Sheet tamat.")), requestTimeout());

    function cleanup(error, data) {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      formElement?.remove();
      iframe.remove();
      error ? reject(error) : resolve(data);
    }

    function onMessage(event) {
      const message = event.data;
      if (!message || message.channel !== "amo-asthma-sheet" || message.requestId !== requestId) return;
      try {
        const host = new URL(event.origin).hostname;
        if (host !== "script.google.com" && !host.endsWith(".googleusercontent.com")) return;
      } catch { return; }
      cleanup(null, message.payload);
    }

    window.addEventListener("message", onMessage);
    iframe.addEventListener("error", () => cleanup(new Error("Gagal menghubungi Google Sheet.")), { once: true });
    document.body.append(iframe);

    const url = new URL(endpoint());
    url.searchParams.set("action", action);
    url.searchParams.set("transport", "iframe");
    url.searchParams.set("requestId", requestId);

    if (method === "POST") {
      formElement = document.createElement("form");
      formElement.hidden = true;
      formElement.method = "POST";
      formElement.action = url.toString();
      formElement.target = iframe.name;
      const payload = document.createElement("input");
      payload.type = "hidden";
      payload.name = "payload";
      payload.value = JSON.stringify({ action, record });
      formElement.append(payload);
      document.body.append(formElement);
      formElement.submit();
    } else {
      iframe.src = url.toString();
    }
  });
}

async function postRecord(record) {
  const response = await sheetRequest("saveAsthmaAssessment", { method: "POST", record });
  if (!response?.ok) throw new Error(response?.error || "Rekod gagal disimpan ke Google Sheet.");
  return response;
}

async function loadSharedRecords(showMessage = false) {
  try {
    const response = await sheetRequest("listAsthmaAssessments");
    if (!response?.ok) throw new Error(response?.error || "Gagal membaca rekod.");
    sharedRecords = Array.isArray(response.records) ? response.records : [];
    syncNotice.hidden = true;
    renderRecords();
    renderStats();
    if (showMessage) showToast("Rekod Google Sheet telah dimuat semula.");
  } catch (error) {
    sharedRecords = getPending();
    syncNotice.hidden = false;
    syncNotice.textContent = `${error.message} Paparan sementara menggunakan rekod belum disegerakkan pada peranti ini.`;
    renderRecords();
    renderStats();
  }
}
async function retryPending() {
  if (!endpoint() || !navigator.onLine) return;
  for (const record of getPending()) {
    try { await postRecord(record); removePending(record.id); }
    catch { break; }
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3500);
}
function resetForm() {
  form.reset();
  document.querySelector('input[name="patientType"][value="adult"]').checked = true;
  document.querySelector('input[name="uptriage"][value="None"]').checked = true;
  setAssessmentTime(new Date());
  state = { ideal: null, beforePercentage: null, afterPercentage: null };
  formDirty = false;
  updateNotDoneMode();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function categoryBadge(category, percentage) {
  if (category === "Not Done" || !Number.isFinite(Number(percentage))) return '<span class="category-badge category-empty">PEFR Not Done</span>';
  return `<span class="category-badge category-${String(category).toLowerCase()}">${Number(percentage).toFixed(1)}% · ${escapeHtml(category)}</span>`;
}
function currentRecords() {
  const merged = [...sharedRecords];
  getPending().forEach(record => { if (!merged.some(item => item.id === record.id)) merged.push(record); });
  return merged;
}
function renderRecords() {
  const list = document.querySelector("#recordList");
  const query = document.querySelector("#recordSearch").value.trim().toLowerCase();
  const records = currentRecords().filter(record => record.date === localDateKey()).filter(record => !query || String(record.patientId).toLowerCase().includes(query)).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  if (!records.length) { list.innerHTML = '<div class="empty-state">Tiada rekod penilaian untuk dipaparkan.</div>'; return; }
  list.innerHTML = records.map(record => {
    const flow = record.pefrNotDone
      ? `<div class="record-flow"><div><b>PEFR Not Done</b>${categoryBadge("Not Done", null)}</div><span class="arrow">·</span><div><b>Sebab</b><small>${escapeHtml(record.notDoneReason || "Tidak dinyatakan")}</small></div></div>`
      : `<div class="record-flow"><div><b>Before · ${record.pefrBefore} L/min</b>${categoryBadge(record.categoryBefore, record.percentageBefore)}</div><span class="arrow">→</span><div><b>After · ${record.pefrAfter} L/min</b>${categoryBadge(record.categoryAfter, record.percentageAfter)}</div></div>`;
    return `<article class="record-card"><div class="record-top"><strong>${escapeHtml(record.patientId)}</strong><small>${escapeHtml(record.time)}</small></div>${flow}<div class="record-footer"><span>${record.patientType === "adult" ? "Dewasa" : "Pediatrik"}${record.pefrIdeal ? ` · Ideal ${record.pefrIdeal} L/min` : ""}</span><span>PPP: ${escapeHtml(record.pppName || "—")} · Uptriage: ${record.uptriage === "None" ? "Tiada" : escapeHtml(record.uptriage)}</span></div></article>`;
  }).join("");
}
function startOfWeek(date) { const result = new Date(date); const day = (result.getDay() + 6) % 7; result.setHours(0, 0, 0, 0); result.setDate(result.getDate() - day); return result; }
function recordsForRange(range) {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  return currentRecords().filter(record => {
    if (range === "all") return true;
    if (range === "today") return record.date === localDateKey(now);
    if (range === "yesterday") return record.date === localDateKey(yesterday);
    const date = new Date(`${record.date}T00:00:00`);
    if (range === "week") return date >= startOfWeek(now);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
}
function countCategory(records, field, value) { return records.filter(record => record[field] === value).length; }
function renderBars(target, records, field) {
  const maximum = Math.max(records.length, 1);
  target.innerHTML = ["Mild", "Moderate", "Severe"].map(category => { const count = countCategory(records, field, category); return `<div class="bar-row"><span>${category}</span><div class="bar-track"><div class="bar bar-${category.toLowerCase()}" style="width:${(count / maximum) * 100}%"></div></div><b>${count}</b></div>`; }).join("");
}
function renderStats() {
  const records = recordsForRange(document.querySelector("#statsRange").value);
  const adults = records.filter(record => record.patientType === "adult").length;
  const yellow = records.filter(record => record.uptriage === "Yellow Zone").length;
  const red = records.filter(record => record.uptriage === "Red Zone").length;
  const notDone = records.filter(record => record.pefrNotDone).length;
  document.querySelector("#statsGrid").innerHTML = [["Jumlah penilaian", records.length], ["Dewasa", adults], ["Pediatrik", records.length - adults], ["Uptriage Yellow", yellow], ["Uptriage Red", red], ["PEFR Not Done", notDone]].map(([label, value]) => `<div class="stat-card"><small>${label}</small><strong>${value}</strong></div>`).join("");
  renderBars(document.querySelector("#beforeBars"), records, "categoryBefore");
  renderBars(document.querySelector("#afterBars"), records, "categoryAfter");
}
function setView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("is-active", view.id === viewId));
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("is-active", button.dataset.view === viewId));
  if (viewId === "todayView" || viewId === "statsView") loadSharedRecords();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

form.addEventListener("input", () => { formDirty = true; calculateAll(); });
form.addEventListener("change", event => {
  formDirty = true;
  if (event.target.name === "patientType") updatePatientType();
  if (event.target.name === "uptriage") renderSummary();
  if (event.target.name === "pefrNotDone" || event.target.name === "notDoneReason") updateNotDoneMode();
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  const validAssessment = isPefrNotDone() ? Boolean(selectedNotDoneReason()) : Boolean(state.ideal && state.beforePercentage !== null && state.afterPercentage !== null);
  if (!form.reportValidity() || !validAssessment) { showToast("Lengkapkan semua maklumat wajib dan bacaan PEFR."); return; }
  const saveButton = document.querySelector("#saveButton");
  const record = makeRecord();
  saveButton.disabled = true;
  addPending(record);
  try {
    await postRecord(record);
    removePending(record.id);
    showToast("Rekod dihantar ke Google Sheet.");
    resetForm();
    window.setTimeout(() => loadSharedRecords(), 1200);
  } catch {
    showToast("Internet/Google Sheet gagal. Rekod disimpan sementara dalam telefon dan akan dicuba semula.");
  } finally { saveButton.disabled = false; }
});

document.querySelector("#resetButton").addEventListener("click", resetForm);
document.querySelector("#recordSearch").addEventListener("input", renderRecords);
document.querySelector("#refreshRecords").addEventListener("click", () => loadSharedRecords(true));
document.querySelector("#refreshStats").addEventListener("click", () => loadSharedRecords(true));
document.querySelector("#statsRange").addEventListener("change", renderStats);
document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
window.addEventListener("online", async () => { await retryPending(); await loadSharedRecords(); });

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
syncNotice.hidden = Boolean(endpoint());
if (!endpoint()) { syncNotice.hidden = false; syncNotice.textContent = "Google Sheet belum disambungkan. Rekod hanya boleh disimpan sementara pada peranti ini."; }
updateNotDoneMode();
retryPending().then(loadSharedRecords);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
