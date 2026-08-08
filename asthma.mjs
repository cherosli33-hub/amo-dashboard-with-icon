import { PAEDIATRIC_PEFR, predictedAdultPef, predictedPaediatricPef, pefrPercentage, classifyPercentage } from "./pefr.mjs";

const PENDING_KEY = "amo-etd-asthma-pending-v2";
const DRAFT_KEY = "amo-etd-asthma-draft-v1";
const DRAFTS_KEY = "amo-etd-asthma-drafts-v2";
const PATIENT_HISTORY_KEY = "amo-etd-asthma-patient-history-v1";
const PATIENT_HISTORY_LIMIT = 500;
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
let pendingSyncPromise = null;
let draftTimer = null;
let activeDraftId = null;

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

// ----- Mod tarikh: Hari ini (auto) vs Tarikh lain (custom, maks 7 hari lepas) -----
let dateMode = "today";
function pad2(n){ return String(n).padStart(2, "0"); }
function toDateInput(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function toTimeInput(d){ return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function initDateControls() {
  const btnToday = document.querySelector("#dtToday");
  const btnOther = document.querySelector("#dtOther");
  const auto = document.querySelector("#dtAuto");
  const custom = document.querySelector("#dtCustom");
  const cDate = document.querySelector("#customDate");
  const cTime = document.querySelector("#customTime");
  if(!btnToday || !btnOther) return;

  function applyBounds() {
    const now = new Date();
    const min = new Date(now); min.setDate(min.getDate() - 7); min.setHours(0,0,0,0);
    cDate.min = toDateInput(min);
    cDate.max = toDateInput(now);
  }
  function setMode(mode) {
    dateMode = mode;
    btnToday.classList.toggle("active", mode === "today");
    btnOther.classList.toggle("active", mode === "other");
    auto.hidden = mode !== "today";
    custom.hidden = mode !== "other";
    if(mode === "today") {
      setAssessmentTime(new Date());
    } else {
      applyBounds();
      const now = new Date();
      if(!cDate.value) cDate.value = toDateInput(now);
      if(!cTime.value) cTime.value = toTimeInput(now);
      syncCustom();
    }
  }
  function syncCustom() {
    if(!cDate.value) return;
    const [y,m,d] = cDate.value.split("-").map(Number);
    const [hh,mm] = (cTime.value || "12:00").split(":").map(Number);
    const picked = new Date(y, m-1, d, hh||0, mm||0, 0, 0);
    // Kekang: tidak boleh masa hadapan, tidak boleh lebih 7 hari lepas
    const now = new Date();
    const min = new Date(now); min.setDate(min.getDate() - 7); min.setHours(0,0,0,0);
    if(picked > now) { setAssessmentTime(new Date()); return; }
    if(picked < min) { return; }
    assessmentTime = picked; // guna terus (jangan papar semula pada medan disabled)
  }
  btnToday.addEventListener("click", () => setMode("today"));
  btnOther.addEventListener("click", () => setMode("other"));
  cDate.addEventListener("change", syncCustom);
  cTime.addEventListener("change", syncCustom);
  applyBounds();
}
function resetDateControls() {
  const btnToday = document.querySelector("#dtToday");
  if(btnToday) btnToday.click();
}
function patientType() { return patientTypeInputs.find(input => input.checked)?.value ?? "adult"; }
function selectedHeight() { return patientType() === "adult" ? Number(adultHeightInput.value) : Number(paediatricHeightInput.value); }
function isPefrNotDone() { return pefrNotDoneInput.checked; }
function selectedNotDoneReason() { return notDoneReasonInputs.find(input => input.checked)?.value ?? ""; }
function selectedUptriage() { return uptriageInputs.find(input => input.checked)?.value ?? "None"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }

function getPatientHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(PATIENT_HISTORY_KEY) || "{}");
    return {
      names: Array.isArray(value.names) ? value.names : [],
      ids: Array.isArray(value.ids) ? value.ids : []
    };
  } catch { return { names: [], ids: [] }; }
}
function uniqueRecent(values) {
  const seen = new Set();
  return values.filter(value => {
    const cleaned = String(value || "").trim();
    const key = cleaned.toLocaleLowerCase("ms");
    if (!cleaned || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, PATIENT_HISTORY_LIMIT);
}
function renderPatientSuggestions() {
  const history = getPatientHistory();
  document.querySelector("#patientNameSuggestions").replaceChildren(...history.names.map(value => Object.assign(document.createElement("option"), { value })));
  document.querySelector("#patientIdSuggestions").replaceChildren(...history.ids.map(value => Object.assign(document.createElement("option"), { value })));
}
function rememberPatient(record) {
  const history = getPatientHistory();
  history.names = uniqueRecent([record.patientName, ...history.names]);
  history.ids = uniqueRecent([record.patientId, ...history.ids]);
  localStorage.setItem(PATIENT_HISTORY_KEY, JSON.stringify(history));
  renderPatientSuggestions();
}
function draftSnapshot() {
  const fields = {};
  [...form.elements].forEach(control => {
    if (!control.name || control.disabled || control.type === "submit" || control.type === "button") return;
    if (control.type === "radio") {
      if (control.checked) fields[control.name] = control.value;
    } else if (control.type === "checkbox") fields[control.name] = control.checked;
    else fields[control.name] = control.value;
  });
  return {
    id: activeDraftId || (crypto.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    fields,
    dateMode,
    customDate: document.querySelector("#customDate").value,
    customTime: document.querySelector("#customTime").value,
    savedAt: new Date().toISOString()
  };
}
function getDrafts() {
  try { const value=JSON.parse(localStorage.getItem(DRAFTS_KEY)||"[]"); return Array.isArray(value)?value:[]; }
  catch { return []; }
}
function storeDrafts(drafts) { localStorage.setItem(DRAFTS_KEY,JSON.stringify(drafts.slice(0,20))); renderDraftManager(); }
function saveDraft() {
  if (!formDirty) return;
  try {
    const snapshot=draftSnapshot(); activeDraftId=snapshot.id;
    const drafts=getDrafts().filter(item=>item.id!==snapshot.id);
    storeDrafts([snapshot,...drafts]);
    localStorage.removeItem(DRAFT_KEY);
  } catch { /* storage unavailable */ }
}
function scheduleDraftSave() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(saveDraft, 400);
}
function clearDraft() {
  window.clearTimeout(draftTimer);
  if(activeDraftId) storeDrafts(getDrafts().filter(item=>item.id!==activeDraftId));
  activeDraftId=null;
  localStorage.removeItem(DRAFT_KEY);
}
function applyDraft(draft) {
  if (!draft?.fields) return;
  activeDraftId=draft.id;
  Object.entries(draft.fields).forEach(([name, value]) => {
    const controls = [...form.elements].filter(control => control.name === name);
    controls.forEach(control => {
      if (control.type === "radio") control.checked = control.value === value;
      else if (control.type === "checkbox") control.checked = Boolean(value);
      else control.value = value ?? "";
    });
  });
  if (draft.dateMode === "other") {
    document.querySelector("#customDate").value = draft.customDate || "";
    document.querySelector("#customTime").value = draft.customTime || "";
    document.querySelector("#dtOther").click();
  }
  formDirty = true;
  updateNotDoneMode();
  calculateAll();
  renderDraftManager();
}
function restoreDraft() {
  let drafts=getDrafts();
  try {
    const legacy=JSON.parse(localStorage.getItem(DRAFT_KEY)||"null");
    if(legacy?.fields){ legacy.id=legacy.id||`draft-${Date.now()}`; drafts=[legacy,...drafts]; storeDrafts(drafts); localStorage.removeItem(DRAFT_KEY); }
  } catch { /* ignore */ }
  if(drafts[0]) applyDraft(drafts[0]);
  else renderDraftManager();
}
function draftLabel(draft) {
  const name=String(draft?.fields?.patientName||"").trim();
  const id=String(draft?.fields?.patientId||"").trim();
  return name||id||"Pesakit belum dinamakan";
}
function renderDraftManager() {
  const target=document.querySelector("#draftList"); if(!target) return;
  const drafts=getDrafts();
  target.innerHTML=drafts.length?drafts.map(draft=>`<article class="draft-item ${draft.id===activeDraftId?"active":""}" data-draft-id="${escapeHtml(draft.id)}"><div class="draft-copy"><strong>${escapeHtml(draftLabel(draft))}</strong><small>${escapeHtml(draft.fields?.patientId||"ID belum diisi")} · disimpan ${new Date(draft.savedAt).toLocaleString("ms-MY")}</small></div><button class="draft-open" type="button">Sambung</button><button class="draft-delete" type="button" aria-label="Padam draf ${escapeHtml(draftLabel(draft))}">Padam</button></article>`).join(""):'<p class="draft-empty">Tiada draf lain. Borang aktif akan disimpan automatik.</p>';
}
function startNextPatient() {
  saveDraft();
  activeDraftId=null;
  resetForm({preserveDrafts:true});
  renderDraftManager();
  showToast("Draf disimpan. Borang pesakit baharu tersedia.");
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
function addPending(record) { const records = getPending().filter(item => item.id !== record.id); records.push({ ...record, syncStatus: "pending" }); setPending(records); }
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

function sheetRequest(action, { method = "GET", record = null, params = {} } = {}) {
  if (window.AMOFirebaseRequest) {
    return window.AMOFirebaseRequest({ module: "asthma", action, method, record, params });
  }
  return new Promise((resolve, reject) => {
    if (!endpoint()) { reject(new Error("Firebase belum disambungkan.")); return; }
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.name = `asthma-sheet-${requestId}`;
    iframe.setAttribute("aria-hidden", "true");
    let formElement = null;
    const timeout = window.setTimeout(() => cleanup(new Error("Masa sambungan Firebase tamat.")), requestTimeout());

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
    iframe.addEventListener("error", () => cleanup(new Error("Gagal menghubungi Firebase.")), { once: true });
    document.body.append(iframe);

    const url = new URL(endpoint());
    url.searchParams.set("action", action);
    url.searchParams.set("transport", "iframe");
    url.searchParams.set("requestId", requestId);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

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
  if (!response?.ok) throw new Error(response?.error || "Rekod gagal disimpan ke Firebase.");
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
    if (showMessage) showToast("Rekod Firebase telah dimuat semula.");
  } catch (error) {
    sharedRecords = getPending();
    syncNotice.hidden = false;
    syncNotice.textContent = `${error.message} Paparan sementara menggunakan rekod belum disegerakkan pada peranti ini.`;
    renderRecords();
    renderStats();
  }
}
async function retryPending() {
  if (!endpoint() || !navigator.onLine) return 0;
  if (pendingSyncPromise) return pendingSyncPromise;
  pendingSyncPromise = (async () => {
    let synced = 0;
    for (const record of getPending()) {
      try {
        await postRecord(record);
        removePending(record.id);
        if (!sharedRecords.some(item => item.id === record.id)) sharedRecords.push({ ...record, syncStatus: "submitted" });
        synced += 1;
      } catch { break; }
    }
    renderRecords();
    renderStats();
    return synced;
  })().finally(() => { pendingSyncPromise = null; });
  return pendingSyncPromise;
}
async function syncPendingInBackground({ notify = true } = {}) {
  const synced = await retryPending();
  if (!synced) return;
  await loadSharedRecords();
  if (notify) showToast(synced === 1 ? "Rekod berjaya disegerakkan ke Firebase." : `${synced} rekod berjaya disegerakkan ke Firebase.`);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3500);
}
function resetForm({ preserveDrafts = false } = {}) {
  if (!preserveDrafts) clearDraft();
  form.reset();
  document.querySelector('input[name="patientType"][value="adult"]').checked = true;
  document.querySelector('input[name="uptriage"][value="None"]').checked = true;
  setAssessmentTime(new Date());
  resetDateControls();
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
  getPending().forEach(record => { if (!merged.some(item => item.id === record.id)) merged.push({ ...record, syncStatus: "pending" }); });
  return merged;
}
function renderRecords() {
  const list = document.querySelector("#recordList");
  const query = document.querySelector("#recordSearch").value.trim().toLowerCase();
  const records = currentRecords().filter(record => record.date === localDateKey()).filter(record => !query || String(record.patientId).toLowerCase().includes(query)).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  if (!records.length) { list.innerHTML = '<div class="empty-state">Tiada rekod penilaian untuk dipaparkan.</div>'; return; }
  list.innerHTML = records.map(record => {
    const syncLabel = record.syncStatus === "pending" ? '<span class="pending-label">Menunggu sync</span>' : "";
    const flow = record.pefrNotDone
      ? `<div class="record-flow"><div><b>PEFR Not Done</b>${categoryBadge("Not Done", null)}</div><span class="arrow">·</span><div><b>Sebab</b><small>${escapeHtml(record.notDoneReason || "Tidak dinyatakan")}</small></div></div>`
      : `<div class="record-flow"><div><b>Before · ${record.pefrBefore} L/min</b>${categoryBadge(record.categoryBefore, record.percentageBefore)}</div><span class="arrow">→</span><div><b>After · ${record.pefrAfter} L/min</b>${categoryBadge(record.categoryAfter, record.percentageAfter)}</div></div>`;
    return `<article class="record-card"><div class="record-top"><strong>${escapeHtml(record.patientId)}</strong><small>${escapeHtml(record.time)} ${syncLabel}</small></div>${flow}<div class="record-footer"><span>${record.patientType === "adult" ? "Dewasa" : "Pediatrik"}${record.pefrIdeal ? ` · Ideal ${record.pefrIdeal} L/min` : ""}</span><span>PPP: ${escapeHtml(record.pppName || "—")} · Uptriage: ${record.uptriage === "None" ? "Tiada" : escapeHtml(record.uptriage)}</span></div></article>`;
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

function patientLookupMarkup(record) {
  const patientTypeLabel = record.patientType === "paediatric" ? "Pediatrik" : "Dewasa";
  const sexLabel = record.sex === "female" ? "Perempuan" : "Lelaki";
  const recordedAt = [record.date ? displayDate(new Date(`${record.date}T12:00:00`)) : "—", record.time || ""].filter(Boolean).join(" · ");
  return `<article class="patient-lookup-card"><h3>${escapeHtml(record.patientName || "Nama tidak direkodkan")}</h3><small>${escapeHtml(record.patientId)}</small><dl class="patient-detail-list"><div><dt>Umur ketika direkodkan</dt><dd>${record.age ?? "—"}${record.age !== null && record.age !== undefined ? " tahun" : ""}</dd></div><div><dt>Tinggi terakhir</dt><dd>${record.height ?? "—"}${record.height !== null && record.height !== undefined ? " cm" : ""}</dd></div><div><dt>Jantina</dt><dd>${sexLabel}</dd></div><div><dt>Kategori</dt><dd>${patientTypeLabel}</dd></div><div><dt>Rekod terakhir</dt><dd>${escapeHtml(recordedAt)}</dd></div></dl><p class="lookup-warning">Maklumat ini berdasarkan rekod terakhir. Sila sahkan semula umur dan tinggi dengan pesakit.</p></article>`;
}
async function lookupPatient() {
  const input = document.querySelector("#patientLookupId");
  const button = document.querySelector("#patientLookupButton");
  const result = document.querySelector("#patientLookupResult");
  const patientId = input.value.trim();
  if (!patientId) { result.innerHTML = '<div class="empty-state">Masukkan No. IC/RN terlebih dahulu.</div>'; input.focus(); return; }
  button.disabled = true;
  button.textContent = "Mencari…";
  result.innerHTML = '<div class="empty-state">Sedang mencari rekod terkini…</div>';
  try {
    const response = await sheetRequest("listAsthmaAssessments");
    if (!response?.ok) throw new Error(response?.error || "Carian gagal.");
    const wanted = patientId.toLocaleLowerCase("ms");
    const record = (Array.isArray(response.records) ? response.records : [])
      .filter(item => String(item.patientId || "").trim().toLocaleLowerCase("ms") === wanted)
      .sort((a, b) => String(b.timestamp || `${b.date}T${b.time}`).localeCompare(String(a.timestamp || `${a.date}T${a.time}`)))[0];
    result.innerHTML = record ? patientLookupMarkup(record) : '<div class="empty-state">Tiada rekod sepadan ditemui.</div>';
  } catch (error) {
    result.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = "Cari Pesakit";
  }
}

// ----- Asthma v1.1: laporan PEFR A4 mingguan / bulanan -----
const reportPeriodType = document.querySelector("#reportPeriodType");
const reportWeekField = document.querySelector("#reportWeekField");
const reportMonthField = document.querySelector("#reportMonthField");
const reportWeekDate = document.querySelector("#reportWeekDate");
const reportMonth = document.querySelector("#reportMonth");
const generatePefrReportButton = document.querySelector("#generatePefrReport");
const reportLoadStatus = document.querySelector("#reportLoadStatus");

function dateFromKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
}
function endOfWeek(date) { const result = startOfWeek(date); result.setDate(result.getDate() + 6); result.setHours(23, 59, 59, 999); return result; }
function reportShift(record) {
  const match = String(record.time || "").match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  if (hour >= 7 && hour < 14) return "Pagi";
  if (hour >= 14 && hour < 21) return "Petang";
  return "Malam";
}
function reportPeriod() {
  if (reportPeriodType.value === "week") {
    const picked = dateFromKey(reportWeekDate.value) || new Date();
    return { type: "week", start: startOfWeek(picked), end: endOfWeek(picked) };
  }
  const value = reportMonth.value || localDateKey().slice(0, 7);
  const [year, month] = value.split("-").map(Number);
  return { type: "month", start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999) };
}
function reportDateLabel(date) { return new Intl.DateTimeFormat("ms-MY", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
function reportPeriodLabel(period) {
  return period.type === "week"
    ? `${reportDateLabel(period.start)} – ${reportDateLabel(period.end)}`
    : new Intl.DateTimeFormat("ms-MY", { month: "long", year: "numeric" }).format(period.start);
}
function recordHasCompletePefr(record) {
  return !record.pefrNotDone && Number.isFinite(Number(record.pefrBefore)) && Number.isFinite(Number(record.pefrAfter)) && Number.isFinite(Number(record.pefrIdeal));
}
function filteredReportRecords(records, period) {
  const shift = document.querySelector("#reportShift").value;
  return records.filter(record => {
    const date = dateFromKey(record.date);
    return date && date >= period.start && date <= period.end && (shift === "all" || reportShift(record) === shift);
  }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
function reportListRecords(records) {
  const status = document.querySelector("#reportStatus").value;
  if (status === "complete") return records.filter(recordHasCompletePefr);
  if (status === "notDone") return records.filter(record => record.pefrNotDone);
  if (status === "uptriage") return records.filter(record => record.uptriage && record.uptriage !== "None");
  return records;
}
function reportKpi(label, value, note, tone = "") {
  return `<div class="print-kpi ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
}
function reportCell(value) { return escapeHtml(value === null || value === undefined || value === "" ? "—" : value); }
function recordVitalText(record) {
  return [`BP ${record.bp || [record.bpSys, record.bpDia].filter(Boolean).join("/") || "—"}`, `HR ${record.hr ?? "—"} | RR ${record.rr ?? "—"}`, `T ${record.temperature ?? "—"} | SpO₂ ${record.spo2 ?? "—"}`].join("<br>");
}
function pefrReading(record, phase) {
  if (record.pefrNotDone) return "Not Done";
  const value = record[`pefr${phase}`];
  const percentage = record[`percentage${phase}`];
  const category = record[`category${phase}`];
  return `${reportCell(value)} L/min<br>${Number.isFinite(Number(percentage)) ? Number(percentage).toFixed(1) : "—"}% · ${reportCell(category)}`;
}
function renderPefrPrintReport(allRecords, period) {
  const complete = allRecords.filter(recordHasCompletePefr);
  const notDone = allRecords.filter(record => record.pefrNotDone).length;
  const uptriage = allRecords.filter(record => record.uptriage && record.uptriage !== "None").length;
  const improved = complete.filter(record => Number(record.pefrAfter) > Number(record.pefrBefore)).length;
  const avgBefore = complete.length ? complete.reduce((sum, record) => sum + Number(record.percentageBefore || 0), 0) / complete.length : 0;
  const avgAfter = complete.length ? complete.reduce((sum, record) => sum + Number(record.percentageAfter || 0), 0) / complete.length : 0;
  const completionRate = allRecords.length ? complete.length / allRecords.length * 100 : 0;
  const improvedRate = complete.length ? improved / complete.length * 100 : 0;
  const periodLabel = reportPeriodLabel(period);
  const shiftValue = document.querySelector("#reportShift").value;
  const listRecords = reportListRecords(allRecords);

  document.querySelector("#printReportTitle").textContent = `LAPORAN ${period.type === "week" ? "MINGGUAN" : "BULANAN"} PENILAIAN PEFR ASMA`;
  document.querySelector("#printReportPeriod").textContent = periodLabel;
  document.querySelector("#printReportShift").textContent = shiftValue === "all" ? "Semua syif" : shiftValue;
  document.querySelector("#printReportTotal").textContent = allRecords.length;
  document.querySelector("#printKpiGrid").innerHTML = [
    reportKpi("Rekod asma", allRecords.length, "Jumlah tempoh dipilih"),
    reportKpi("PEFR dibuat", allRecords.length - notDone, `${allRecords.length ? ((allRecords.length - notDone) / allRecords.length * 100).toFixed(1) : "0.0"}% pesakit`, "good"),
    reportKpi("Before + After lengkap", complete.length, `${completionRate.toFixed(1)}% pematuhan`, "good"),
    reportKpi("PEFR tidak dibuat", notDone, `${allRecords.length ? (notDone / allRecords.length * 100).toFixed(1) : "0.0"}% pesakit`, "warn"),
    reportKpi("Bacaan meningkat", improved, `${improvedRate.toFixed(1)}% rekod lengkap`, "good"),
    reportKpi("Uptriage", uptriage, `${allRecords.length ? (uptriage / allRecords.length * 100).toFixed(1) : "0.0"}% rekod`, "bad")
  ].join("");
  document.querySelector("#printAnalysisGrid").innerHTML = [
    `<div class="print-analysis-card"><strong>Purata PEFR</strong><br>Sebelum <b>${avgBefore.toFixed(1)}%</b> → Selepas <b>${avgAfter.toFixed(1)}%</b><br>Perubahan <b>${avgAfter >= avgBefore ? "+" : ""}${(avgAfter - avgBefore).toFixed(1)}</b> mata peratus</div>`,
    `<div class="print-analysis-card"><strong>Perubahan kategori</strong><br>Mild: ${countCategory(complete, "categoryBefore", "Mild")} → <b>${countCategory(complete, "categoryAfter", "Mild")}</b><br>Moderate: ${countCategory(complete, "categoryBefore", "Moderate")} → <b>${countCategory(complete, "categoryAfter", "Moderate")}</b><br>Severe: ${countCategory(complete, "categoryBefore", "Severe")} → <b>${countCategory(complete, "categoryAfter", "Severe")}</b></div>`,
    `<div class="print-analysis-card"><strong>Status dokumentasi</strong><br>Lengkap: <b>${complete.length}</b><br>Not Done dengan sebab: <b>${allRecords.filter(record => record.pefrNotDone && record.notDoneReason).length}</b><br>Senarai dipaparkan: <b>${listRecords.length}</b></div>`
  ].join("");
  document.querySelector("#printReportRows").innerHTML = listRecords.length ? listRecords.map(record => {
    const change = recordHasCompletePefr(record) ? Number(record.pefrAfter) - Number(record.pefrBefore) : null;
    const action = record.pefrNotDone ? `PEFR Not Done<br>${reportCell(record.notDoneReason)}${record.notDoneOther ? `<br>${reportCell(record.notDoneOther)}` : ""}` : (record.uptriage === "None" ? "Tiada" : reportCell(record.uptriage));
    return `<tr><td>${reportCell(record.date)}<br>${reportCell(record.time)}</td><td>${reportCell(record.patientId)}</td><td>${record.patientType === "adult" ? "Dewasa" : "Pediatrik"}<br>${reportCell(record.patientName)}</td><td>${reportCell(record.age)} thn / ${record.sex === "female" ? "Perempuan" : "Lelaki"}</td><td>${recordVitalText(record)}</td><td>${reportCell(record.pefrIdeal)}</td><td>${pefrReading(record, "Before")}</td><td>${pefrReading(record, "After")}</td><td>${change === null ? "—" : `${change >= 0 ? "+" : ""}${change} L/min`}</td><td>${action}</td><td>${reportCell(record.pppName)}</td></tr>`;
  }).join("") : '<tr><td colspan="11" style="text-align:center;padding:18px">Tiada rekod bagi pilihan ini.</td></tr>';
  document.querySelector("#printAuditSummary").innerHTML = allRecords.length
    ? `<b>${complete.length} daripada ${allRecords.length} rekod (${completionRate.toFixed(1)}%)</b> mempunyai bacaan PEFR Before dan After lengkap. Daripada rekod lengkap, <b>${improved} kes (${improvedRate.toFixed(1)}%)</b> menunjukkan peningkatan selepas rawatan. ${notDone} rekod PEFR tidak dibuat dan ${uptriage} kes direkodkan uptriage.`
    : "Tiada rekod bagi tempoh dan syif yang dipilih.";
  document.querySelector("#reportPageHint").textContent = `${listRecords.length} rekod dipaparkan. Senarai panjang akan bersambung ke muka surat seterusnya.`;
  document.querySelector("#pefrReportPreview").hidden = false;
}
async function generatePefrReport() {
  const originalText = generatePefrReportButton.textContent;
  generatePefrReportButton.disabled = true;
  generatePefrReportButton.textContent = "Mengambil data…";
  reportLoadStatus.textContent = "Meminta rekod terkini daripada Firebase…";
  try {
    const response = await sheetRequest("listAsthmaAssessments");
    if (!response?.ok) throw new Error(response?.error || "Gagal membaca data Firebase.");
    const records = Array.isArray(response.records) ? response.records : [];
    sharedRecords = records;
    const period = reportPeriod();
    const selected = filteredReportRecords(records, period);
    renderPefrPrintReport(selected, period);
    reportLoadStatus.textContent = `${selected.length} rekod diterima dan laporan siap dipratonton.`;
    document.querySelector("#pefrReportPreview").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    reportLoadStatus.textContent = error.message;
    showToast(error.message);
  } finally {
    generatePefrReportButton.disabled = false;
    generatePefrReportButton.textContent = originalText;
  }
}
function initPefrReport() {
  const today = new Date();
  reportWeekDate.value = localDateKey(today);
  reportMonth.value = localDateKey(today).slice(0, 7);
  reportPeriodType.addEventListener("change", () => {
    const weekly = reportPeriodType.value === "week";
    reportWeekField.hidden = !weekly;
    reportMonthField.hidden = weekly;
  });
  generatePefrReportButton.addEventListener("click", generatePefrReport);
  document.querySelector("#printPefrReport").addEventListener("click", () => window.print());
}
function setView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("is-active", view.id === viewId));
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("is-active", button.dataset.view === viewId));
  if (viewId === "todayView" || viewId === "statsView") loadSharedRecords();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

form.addEventListener("input", () => { formDirty = true; calculateAll(); scheduleDraftSave(); });
form.addEventListener("change", event => {
  formDirty = true;
  if (event.target.name === "patientType") updatePatientType();
  if (event.target.name === "uptriage") renderSummary();
  if (event.target.name === "pefrNotDone" || event.target.name === "notDoneReason") updateNotDoneMode();
  scheduleDraftSave();
});
form.addEventListener("submit", event => {
  event.preventDefault();
  const validAssessment = isPefrNotDone() ? Boolean(selectedNotDoneReason()) : Boolean(state.ideal && state.beforePercentage !== null && state.afterPercentage !== null);
  if (!form.reportValidity() || !validAssessment) { showToast("Lengkapkan semua maklumat wajib dan bacaan PEFR."); return; }
  const record = makeRecord();
  try {
    addPending(record);
    rememberPatient(record);
  } catch {
    showToast("Rekod tidak dapat disimpan dalam telefon. Sila cuba semula.");
    return;
  }
  renderRecords();
  renderStats();
  resetForm();
  showToast("Rekod disimpan. Penyegerakan ke Firebase berjalan di belakang.");
  void syncPendingInBackground();
});

document.querySelector("#resetButton").addEventListener("click", resetForm);
document.querySelector("#newPatientDraft").addEventListener("click",startNextPatient);
document.querySelector("#draftList").addEventListener("click",event=>{
  const item=event.target.closest("[data-draft-id]"); if(!item) return;
  const id=item.dataset.draftId;
  if(event.target.closest(".draft-delete")){
    if(!confirm("Padam draf pesakit ini?")) return;
    storeDrafts(getDrafts().filter(draft=>draft.id!==id));
    if(activeDraftId===id){ activeDraftId=null; resetForm({preserveDrafts:true}); }
    renderDraftManager(); return;
  }
  if(event.target.closest(".draft-open")){
    saveDraft();
    const draft=getDrafts().find(item=>item.id===id); if(!draft) return;
    resetForm({preserveDrafts:true}); applyDraft(draft); window.scrollTo({top:0,behavior:"smooth"});
  }
});
document.querySelector(".back-link").addEventListener("click",()=>saveDraft());
window.addEventListener("pagehide",()=>saveDraft());
window.addEventListener("beforeunload",()=>saveDraft());
document.querySelector("#recordSearch").addEventListener("input", renderRecords);
document.querySelector("#recordSearch").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); renderRecords(); } });
document.querySelector("#searchRecords").addEventListener("click", renderRecords);
document.querySelector("#patientLookupButton").addEventListener("click", lookupPatient);
document.querySelector("#patientLookupId").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void lookupPatient(); } });
document.querySelector("#refreshRecords").addEventListener("click", () => loadSharedRecords(true));
document.querySelector("#refreshStats").addEventListener("click", () => loadSharedRecords(true));
document.querySelector("#statsRange").addEventListener("change", renderStats);
document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
window.addEventListener("online", () => { void syncPendingInBackground(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) void syncPendingInBackground({ notify: false }); });
window.setInterval(() => { if (getPending().length) void syncPendingInBackground({ notify: false }); }, 30000);

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
initDateControls();
initPefrReport();
renderPatientSuggestions();
restoreDraft();
syncNotice.hidden = Boolean(endpoint());
if (!endpoint()) { syncNotice.hidden = false; syncNotice.textContent = "Firebase belum disambungkan. Rekod hanya boleh disimpan sementara pada peranti ini."; }
updateNotDoneMode();
syncPendingInBackground({ notify: false }).then(() => loadSharedRecords());
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
