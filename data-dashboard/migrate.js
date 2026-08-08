import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth, db } from "../shared/firebase/core.js";
import { prepareAuth } from "../shared/firebase/auth.js";
import { getProfile, isAdmin } from "../shared/firebase/users.js";

const endpoints = {
  procedure: "https://script.google.com/macros/s/AKfycbzifWmcwyfnJQ1yamRaEbondcxfmyiCUKeg_U7XryTD-kQoh3iitOMARH4aP6RcLH94/exec?action=data",
  asthma: "https://script.google.com/macros/s/AKfycbxjWAkUq6OCh2CJveP_KCyDtpTNmqJuSyzTWx_VKivHbkHs9FM-XaRHSePT9nR4aWVI/exec?action=listAsthmaAssessments",
  phc: "https://script.google.com/macros/s/AKfycbx7KVGaTsaAHisXB0W0Df3mc6NeM0MAhAs1xkAhU0ImyDxsw3_u01_7dxXKLi6TeQ1N1g/exec?action=dashboard&from=2000-01-01&to=2100-12-31",
  girn: "https://script.google.com/macros/s/AKfycbwjMIbhsiT-0pIiqkDCUCN6V0x1uA02slX3G0UjNXA963-eWX8OaAZ56J3fNf1qsO0A/exec?action=dashboard"
};

const title = document.querySelector("#title");
const status = document.querySelector("#status");
const log = document.querySelector("#log");
const button = document.querySelector("#importBtn");
const clean = value => JSON.parse(JSON.stringify(value));

async function stableId(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(item => item.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function read(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} semasa membaca data lama`);
  return response.json();
}

async function procedureDocuments(rows) {
  const [headers, ...data] = rows;
  const index = Object.fromEntries(headers.map((name, position) => [name, position]));
  const grouped = new Map();
  for (const row of data) {
    const key = [row[index.Timestamp], row[index.Date], row[index.Time], row[index.Shift], row[index.Zone], row[index.IDPesakit]].join("|");
    if (!grouped.has(key)) grouped.set(key, {
      id: `legacy-${await stableId(key)}`,
      savedAt: row[index.Timestamp], date: String(row[index.Date]).slice(0, 10), time: row[index.Time],
      shift: row[index.Shift], zone: row[index.Zone] || "", registrationNumber: String(row[index.IDPesakit] || ""),
      patientId: String(row[index.IDPesakit] || ""), procedures: [], module: "procedure", migrationSource: "google-sheets"
    });
    grouped.get(key).procedures.push({ name: row[index.Procedure], minutes: Number(row[index.DurationMinutes]) });
  }
  return [...grouped.values()];
}

async function buildGroups() {
  const [procedureRaw, asthmaRaw, phcRaw, girnRaw] = await Promise.all(Object.values(endpoints).map(read));
  return {
    procedure_cases: await procedureDocuments(procedureRaw),
    asthma_assessments: (asthmaRaw.records || []).map(item => ({ ...item, module: "asthma", migrationSource: "google-sheets" })),
    phc_inspections: (phcRaw.records || []).map(item => ({ ...item, module: "phc", migrationSource: "google-sheets" })),
    phc_findings: (phcRaw.findings || []).map(item => ({ ...item, module: "phc", migrationSource: "google-sheets" })),
    girn_inspections: (girnRaw.inspections || []).map(item => ({ ...item, module: "girn", migrationSource: "google-sheets" })),
    girn_findings: (girnRaw.findings || []).map(item => ({ ...item, module: "girn", migrationSource: "google-sheets" }))
  };
}

async function importGroups(groups) {
  for (const [collectionName, records] of Object.entries(groups)) {
    for (let offset = 0; offset < records.length; offset += 400) {
      const batch = writeBatch(db);
      for (const record of records.slice(offset, offset + 400)) {
        const id = String(record.id || await stableId(JSON.stringify(record)));
        batch.set(doc(db, collectionName, id), clean(record), { merge: true });
      }
      await batch.commit();
    }
    log.textContent += `${collectionName}: ${records.length} rekod\n`;
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Membaca data lama…";
  try {
    const groups = await buildGroups();
    log.textContent = Object.entries(groups).map(([name, rows]) => `${name}: ${rows.length} rekod ditemui`).join("\n") + "\n\n";
    status.textContent = "Menulis data ke Firebase…";
    await importGroups(groups);
    title.textContent = "Import selesai";
    status.textContent = "Semua koleksi telah diimport secara idempotent.";
  } catch (error) {
    title.textContent = "Import tidak berjaya";
    status.textContent = error.message || String(error);
    button.disabled = false;
  }
});

await prepareAuth();
onAuthStateChanged(auth, async user => {
  const profile = user && !user.isAnonymous ? await getProfile(user.uid).catch(() => null) : null;
  if (!isAdmin(profile)) {
    title.textContent = "Akses tidak dibenarkan";
    status.textContent = "Log masuk sebagai admin di dashboard utama.";
    return;
  }
  title.textContent = "Sedia untuk import";
  status.textContent = "Data lama akan disalin ke Firebase tanpa mengubah Google Sheets asal.";
  button.hidden = false;
});
