import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./core.js";
import { ensureAppSession } from "./auth.js";
import { COLLECTIONS } from "./database.js";
import { getProfile, isSupervisor } from "./users.js";

const ENDPOINTS = Object.freeze({
  procedure: "firebase-v2-procedure",
  asthma: "firebase-v2-asthma",
  phc: "firebase-v2-phc",
  girn: "firebase-v2-girn"
});

function plain(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

async function list(name) {
  await ensureAppSession();
  const snapshot = await getDocs(query(collection(db, name), limit(5000)));
  return snapshot.docs.map(item => ({ id: item.id, ...plain(item.data()) }));
}

function inRange(item, from = "2000-01-01", to = "2100-12-31") {
  const key = String(item.date || item.dateKey || "").slice(0, 10);
  return key >= from && key <= to;
}

async function save(name, id, data, merge = false) {
  await ensureAppSession();
  await setDoc(doc(db, name, String(id)), { ...data, updatedAt: serverTimestamp() }, { merge });
}

function moduleFromUrl(url) {
  const text = String(url);
  return Object.entries(ENDPOINTS).find(([, marker]) => text.includes(marker))?.[0] || "";
}

function parseBody(init) {
  if (!init?.body) return {};
  if (typeof init.body === "string") {
    try { return JSON.parse(init.body); } catch { return {}; }
  }
  return {};
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function procedureRequest(action, body) {
  if (action === "data") {
    const records = (await list(COLLECTIONS.procedure)).sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    const rows = [["Timestamp", "Date", "Time", "Shift", "Zone", "IDPesakit", "Procedure", "DurationMinutes", "OrderedBy"]];
    records.forEach(record => (record.procedures || []).forEach(procedure => rows.push([
      record.savedAt || record.timestamp || record.id,
      record.date,
      record.time,
      record.shift,
      record.zone || "",
      record.registrationNumber || record.patientId || "",
      procedure.name,
      Number(procedure.minutes || 0),
      procedure.orderedBy || ""
    ])));
    return rows;
  }
  const record = body || {};
  if (!record.id || !record.date || !record.shift || !(record.procedures || []).length) throw new Error("Rekod prosedur tidak lengkap.");
  await save(COLLECTIONS.procedure, record.id, {
    ...record,
    module: "procedure",
    savedAt: record.savedAt || new Date().toISOString(),
    createdBy: auth.currentUser?.uid || ""
  });
  return { result: "success", id: record.id };
}

async function asthmaRequest(action, body) {
  if (action === "listAsthmaAssessments") {
    const records = (await list(COLLECTIONS.asthma)).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return { ok: true, records: records.map(record => ({ ...record, syncStatus: "submitted" })) };
  }
  if (action !== "saveAsthmaAssessment") throw new Error("Tindakan Asma tidak dikenali.");
  const record = body.record || body;
  if (!record.id || !record.patientId || !record.pppName) throw new Error("Rekod penilaian Asma tidak lengkap.");
  const ref = doc(db, COLLECTIONS.asthma, String(record.id));
  await ensureAppSession();
  const existing = await getDoc(ref);
  if (!existing.exists()) await setDoc(ref, {
    ...record,
    module: "asthma",
    timestamp: record.timestamp || new Date().toISOString(),
    createdBy: auth.currentUser?.uid || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { ok: true, recordId: record.id, duplicate: existing.exists() };
}

function phcFinding(record, item, index) {
  return {
    type: "shortage",
    id: `${record.id}-F${String(index + 1).padStart(3, "0")}`,
    inspectionId: record.id,
    date: record.date,
    bagShift: `${record.bag} / ${record.shift}`,
    item: item.name,
    qty: Number(item.qty),
    standard: Number(item.standard),
    note: "",
    action: "",
    actionAt: "",
    status: "Belum diambil tindakan"
  };
}

async function savePhcInspection(record) {
  if (!record?.id || !record.checkKey || !record.date || !record.bag || !record.shift || !record.ppp) throw new Error("Rekod PHC tidak lengkap.");
  const items = Object.values(record.quantities || {}).flatMap(category => category.items || []);
  await save(COLLECTIONS.phc, record.id, {
    ...record,
    module: "phc",
    syncStatus: "SYNCED",
    savedAt: record.savedAt || new Date().toISOString(),
    createdBy: auth.currentUser?.uid || ""
  });
  const shortages = items.filter(item => Number(item.qty) < Number(item.standard));
  const existingFindings = await list(COLLECTIONS.phcFindings);
  for (let index = 0; index < shortages.length; index += 1) {
    const finding = phcFinding(record, shortages[index], index);
    const priorOpen = existingFindings
      .filter(item => item.type === "shortage" && item.item === finding.item && String(item.bagShift || "").startsWith(`${record.bag} /`) && item.status === "Belum diambil tindakan")
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
    if (priorOpen) finding.id = priorOpen.id;
    const ref = doc(db, COLLECTIONS.phcFindings, finding.id);
    const current = await getDoc(ref);
    const prior = current.exists() ? plain(current.data()) : null;
    await setDoc(ref, prior ? {
      ...finding,
      action: prior.action || "",
      actionAt: prior.actionAt || "",
      status: prior.status || finding.status,
      createdAt: prior.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    } : { ...finding, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  if (record.notes) {
    const finding = {
      type: "note", id: `${record.id}-NOTE`, inspectionId: record.id, date: record.date,
      bagShift: `${record.bag} / ${record.shift}`, item: "", qty: null, standard: null,
      note: record.notes, action: "", actionAt: "", status: "Belum diambil tindakan"
    };
    await save(COLLECTIONS.phcFindings, finding.id, finding, true);
  }
  return { ok: true, id: record.id, savedAt: new Date().toISOString(), itemCount: items.length, findingCount: shortages.length + (record.notes ? 1 : 0) };
}

async function requireSupervisor() {
  const user = auth.currentUser || await ensureAppSession();
  if (user.isAnonymous) throw new Error("Log masuk Google diperlukan.");
  const profile = await getProfile(user.uid);
  if (!isSupervisor(profile)) throw new Error("Akaun belum diberi akses admin atau penyelia.");
  return { uid: user.uid, email: user.email || "", name: profile.name || user.displayName || "", role: profile.role };
}

async function phcRequest(action, params, body) {
  if (action === "saveInspection") return savePhcInspection(body.record);
  if (action === "records" || action === "dashboard" || action === "latestInventory") {
    let records = (await list(COLLECTIONS.phc)).filter(item => inRange(item, params.from, params.to));
    if (action === "latestInventory") {
      const latest = {};
      records.forEach(record => { if (!latest[record.bag] || String(record.savedAt) > String(latest[record.bag].savedAt)) latest[record.bag] = record; });
      const resolved = (await list(COLLECTIONS.phcFindings)).filter(item => item.type === "shortage" && item.status !== "Belum diambil tindakan");
      records = Object.values(latest).map(record => {
        const copy = structuredClone(record);
        Object.values(copy.quantities || {}).forEach(group => (group.items || []).forEach(item => {
          const restored = resolved.some(finding => finding.item === item.name && String(finding.bagShift || "").startsWith(`${record.bag} /`) && String(finding.actionAt || finding.updatedAt || "") > String(record.savedAt || ""));
          if (restored && Number(item.qty) < Number(item.standard)) item.qty = Number(item.standard);
        }));
        return copy;
      });
    }
    if (action === "dashboard") {
      const findings = (await list(COLLECTIONS.phcFindings)).filter(item => inRange(item, params.from, params.to));
      return { ok: true, records, findings };
    }
    return { ok: true, records };
  }
  if (action === "findings") {
    const findings = (await list(COLLECTIONS.phcFindings)).filter(item => inRange(item, params.from, params.to));
    return { ok: true, findings: params.all === "1" ? findings : findings.filter(item => item.type === "note") };
  }
  if (action === "resolveFinding") {
    const id = String(body.findingId || "");
    await updateDoc(doc(db, COLLECTIONS.phcFindings, id), {
      action: String(body.resolution || body.status || ""),
      actionAt: new Date().toISOString(),
      status: body.status || "Telah diambil tindakan",
      updatedAt: serverTimestamp()
    });
    return { ok: true, findingId: id, status: body.status, savedAt: new Date().toISOString() };
  }
  if (action === "supervisorSession") return { ok: true, supervisor: await requireSupervisor() };
  if (action === "supervisorRecords") return {
    ok: true, supervisor: await requireSupervisor(),
    records: (await list(COLLECTIONS.phc)).filter(item => inRange(item, body.from, body.to))
  };
  if (action === "verifyInspections") {
    const supervisor = await requireSupervisor();
    const now = new Date().toISOString();
    let verified = 0;
    for (const id of body.recordIds || []) {
      const ref = doc(db, COLLECTIONS.phc, String(id));
      const snapshot = await getDoc(ref);
      if (!snapshot.exists() || snapshot.data().verified) continue;
      await updateDoc(ref, { verified: true, verifiedBy: supervisor.name, verifiedEmail: supervisor.email, verifiedAt: now, updatedAt: serverTimestamp() });
      verified += 1;
    }
    return { ok: true, verified, alreadyVerified: (body.recordIds || []).length - verified };
  }
  throw new Error("Tindakan PHC tidak dikenali.");
}

function girnAudit(inspections, findings) {
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit" }).format(new Date());
  const today = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit" }).format(new Date()));
  const rows = [];
  for (let day = 1; day <= today; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const matches = inspections.filter(item => item.date === date);
    const shifts = [...new Set(matches.map(item => item.shift))];
    const countFindings = findings.filter(item => item.date === date).length;
    const compliant = matches.length >= 2;
    rows.push({
      date,
      day: new Intl.DateTimeFormat("ms-MY", { timeZone: "Asia/Kuala_Lumpur", weekday: "long" }).format(new Date(`${date}T12:00:00+08:00`)),
      count: matches.length,
      shifts: shifts.join(", "),
      status: compliant ? "Patuh" : "Tidak patuh",
      findings: countFindings,
      note: compliant ? `${matches.length} pemeriksaan lengkap` : "Kurang daripada 2 pemeriksaan"
    });
  }
  const compliantDays = rows.filter(row => row.status === "Patuh").length;
  return { ok: true, month, expectedDays: today, compliantDays, nonCompliantDays: today - compliantDays, compliancePercentage: today ? Math.round(compliantDays / today * 100) : 0, rows };
}

async function girnRequest(action, body) {
  if (action === "dashboard") {
    const inspections = (await list(COLLECTIONS.girn)).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    const findings = await list(COLLECTIONS.girnFindings);
    const officerNames = [...new Set(inspections.map(item => item.officer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ms-MY"));
    return { ok: true, inspections, findings, officerNames, audit: girnAudit(inspections, findings) };
  }
  if (action === "submitInspection") {
    const record = body;
    if (!record.date || !record.shift || !record.officer || !Array.isArray(record.devices)) throw new Error("Rekod GIRN tidak lengkap.");
    const stamp = String(record.submittedAt || new Date().toISOString()).replace(/\D/g, "").slice(0, 14);
    const id = record.id || `GIRN-${stamp}`;
    await save(COLLECTIONS.girn, id, { ...record, id, module: "girn", submittedAt: record.submittedAt || new Date().toISOString(), createdBy: auth.currentUser?.uid || "" });
    const failed = record.devices.filter(device => device.status !== "Berfungsi");
    for (let index = 0; index < failed.length; index += 1) {
      const device = failed[index];
      const finding = {
        id: `F-${stamp}-${String(index + 1).padStart(2, "0")}`,
        recordId: id, date: record.date, reportedAt: record.submittedAt || new Date().toISOString(),
        shift: record.shift, device: device.name, inspectionStatus: device.status, note: device.note,
        reporter: record.officer, state: "Baharu", acknowledgedBy: "", acknowledgedAt: "", action: "", resolvedBy: "", resolvedAt: ""
      };
      await save(COLLECTIONS.girnFindings, finding.id, finding);
    }
    return { ok: true, id };
  }
  if (action === "updateFinding") {
    const finding = body.finding || {};
    if (!finding.id) throw new Error("ID penemuan GIRN diperlukan.");
    await save(COLLECTIONS.girnFindings, finding.id, finding, true);
    return { ok: true, id: finding.id };
  }
  throw new Error("Tindakan GIRN tidak dikenali.");
}

export async function firebaseRequest({ module, action, method = "GET", record = null, params = {}, body = null }) {
  await ensureAppSession();
  const payload = body || (record ? { action, record } : { action });
  if (module === "procedure") return procedureRequest(action, payload);
  if (module === "asthma") return asthmaRequest(action, payload);
  if (module === "phc") return phcRequest(action, params, payload);
  if (module === "girn") return girnRequest(action, payload);
  throw new Error("Modul Firebase tidak dikenali.");
}

export function subscribeModule(moduleName, callback, onError) {
  const collectionName = {
    procedure: COLLECTIONS.procedure,
    asthma: COLLECTIONS.asthma,
    phc: COLLECTIONS.phc,
    girn: COLLECTIONS.girn,
    girnFindings: COLLECTIONS.girnFindings
  }[moduleName];
  if (!collectionName) throw new Error("Modul Firebase tidak dikenali.");
  let stop = () => {};
  ensureAppSession().then(() => {
    stop = onSnapshot(query(collection(db, collectionName), limit(5000)), snapshot => {
      callback(snapshot.docs.map(item => ({ id: item.id, ...plain(item.data()) })));
    }, onError);
  }).catch(onError);
  return () => stop();
}

export async function firebaseFetch(input, init = {}) {
  try {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, location.href);
    const module = moduleFromUrl(url.href);
    const body = parseBody(init);
    const action = body.action || url.searchParams.get("action") || (module === "procedure" && (init.method || "GET").toUpperCase() === "POST" ? "save" : "health");
    const params = Object.fromEntries(url.searchParams.entries());
    const result = await firebaseRequest({ module, action, method: init.method || "GET", body, params });
    return jsonResponse(result);
  } catch (error) {
    console.error("[AMO Firebase]", error);
    return jsonResponse({ ok: false, result: "error", error: error.message || String(error), message: error.message || String(error) }, 500);
  }
}
