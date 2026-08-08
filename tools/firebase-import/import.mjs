import { createHash } from "node:crypto";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "amo-dashboard-v2";
const COMMIT = process.argv.includes("--commit");
const endpoints = {
  procedure:"https://script.google.com/macros/s/AKfycbzifWmcwyfnJQ1yamRaEbondcxfmyiCUKeg_U7XryTD-kQoh3iitOMARH4aP6RcLH94/exec?action=data",
  asthma:"https://script.google.com/macros/s/AKfycbxjWAkUq6OCh2CJveP_KCyDtpTNmqJuSyzTWx_VKivHbkHs9FM-XaRHSePT9nR4aWVI/exec?action=listAsthmaAssessments",
  phc:"https://script.google.com/macros/s/AKfycbx7KVGaTsaAHisXB0W0Df3mc6NeM0MAhAs1xkAhU0ImyDxsw3_u01_7dxXKLi6TeQ1N1g/exec?action=dashboard&from=2000-01-01&to=2100-12-31",
  girn:"https://script.google.com/macros/s/AKfycbwjMIbhsiT-0pIiqkDCUCN6V0x1uA02slX3G0UjNXA963-eWX8OaAZ56J3fNf1qsO0A/exec?action=dashboard"
};

const clean = value => JSON.parse(JSON.stringify(value));
const stableId = value => createHash("sha256").update(value).digest("hex").slice(0, 32);
async function read(url) { const response=await fetch(url,{redirect:"follow"}); if(!response.ok)throw new Error(`${response.status} ${url}`); return response.json(); }

function procedureDocuments(rows) {
  const [headers,...data] = rows; const index=Object.fromEntries(headers.map((name,i)=>[name,i])); const grouped=new Map();
  data.forEach(row=>{const key=[row[index.Timestamp],row[index.Date],row[index.Time],row[index.Shift],row[index.Zone],row[index.IDPesakit]].join("|");if(!grouped.has(key))grouped.set(key,{id:`legacy-${stableId(key)}`,savedAt:row[index.Timestamp],date:String(row[index.Date]).slice(0,10),time:row[index.Time],shift:row[index.Shift],zone:row[index.Zone]||"",registrationNumber:String(row[index.IDPesakit]||""),patientId:String(row[index.IDPesakit]||""),procedures:[],module:"procedure",migrationSource:"google-sheets"});grouped.get(key).procedures.push({name:row[index.Procedure],minutes:Number(row[index.DurationMinutes])});});
  return [...grouped.values()];
}

const [procedureRaw,asthmaRaw,phcRaw,girnRaw]=await Promise.all(Object.values(endpoints).map(read));
const groups = {
  procedure_cases:procedureDocuments(procedureRaw),
  asthma_assessments:(asthmaRaw.records||[]).map(x=>({...x,module:"asthma",migrationSource:"google-sheets"})),
  phc_inspections:(phcRaw.records||[]).map(x=>({...x,module:"phc",migrationSource:"google-sheets"})),
  phc_findings:(phcRaw.findings||[]).map(x=>({...x,module:"phc",migrationSource:"google-sheets"})),
  girn_inspections:(girnRaw.inspections||[]).map(x=>({...x,module:"girn",migrationSource:"google-sheets"})),
  girn_findings:(girnRaw.findings||[]).map(x=>({...x,module:"girn",migrationSource:"google-sheets"}))
};
console.table(Object.entries(groups).map(([collection,records])=>({collection,records:records.length})));
if(!COMMIT){console.log("Dry run sahaja. Jalankan semula dengan --commit selepas semak kiraan.");process.exit(0);}

initializeApp({credential:applicationDefault(),projectId:PROJECT_ID}); const db=getFirestore();
for(const [collection,records] of Object.entries(groups)){
  for(let offset=0;offset<records.length;offset+=400){const batch=db.batch();records.slice(offset,offset+400).forEach(record=>{const id=String(record.id||stableId(JSON.stringify(record)));batch.set(db.collection(collection).doc(id),clean(record),{merge:true});});await batch.commit();}
  console.log(`${collection}: ${records.length} rekod diimport`);
}
console.log("Import selesai secara idempotent.");
