import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth, db } from "../shared/firebase/core.js";
import { logout, prepareAuth } from "../shared/firebase/auth.js";
import { getProfile, isSupervisor } from "../shared/firebase/users.js";
import { COLLECTIONS } from "../shared/firebase/database.js";

const TZ = "Asia/Kuala_Lumpur";
const number = new Intl.NumberFormat("ms-MY");
const gate = document.querySelector("#gate");
const dashboard = document.querySelector("#dashboard");
const userLabel = document.querySelector("#userLabel");
const logoutBtn = document.querySelector("#logoutBtn");
let sessionUser = null;
let sessionProfile = null;
let activeModule = "procedure";
let currentReport = "";

const MODULES = {
  procedure:{ label:"Prosedur", color:"#16805d", periods:["weekly","monthly","yearly"] },
  asthma:{ label:"Asthma", color:"#147b80", periods:["daily","monthly"] },
  phc:{ label:"PHC", color:"#b91c32", periods:["daily","monthly","yearly"], supervisor:true },
  girn:{ label:"GIRN", color:"#365ca8", periods:["daily","monthly","yearly"], supervisor:true }
};
const PERIOD_LABEL = { daily:"Harian", weekly:"Mingguan", monthly:"Bulanan", yearly:"Tahunan" };
const MONTHS = ["Januari","Februari","Mac","April","Mei","Jun","Julai","Ogos","September","Oktober","November","Disember"];
const SHIFTS = ["Pagi","Petang","Malam"];

function esc(value="") { return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function isoDate(date=new Date()) { return new Intl.DateTimeFormat("sv-SE",{timeZone:TZ}).format(date); }
function todayParts(){ const d=new Date(); return { date:isoDate(d), year:Number(new Intl.DateTimeFormat("en",{year:"numeric",timeZone:TZ}).format(d)), month:Number(new Intl.DateTimeFormat("en",{month:"numeric",timeZone:TZ}).format(d)) }; }
function actorName(){ return sessionProfile?.name || sessionUser?.displayName || sessionUser?.email || "Penyelia"; }
function displayDate(value){ if(!value) return "—"; const d=new Date(`${String(value).slice(0,10)}T12:00:00+08:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("ms-MY",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:TZ}); }
function doneStatus(value){ return ["selesai","telah diambil tindakan","telah diambil maklum","diambil maklum","disahkan","completed","closed","acknowledged","verified"].includes(String(value||"").trim().toLowerCase()); }
function normalizeShift(value){ const x=String(value||"").toLowerCase(); if(x.includes("pagi")||x==="morning") return "Pagi"; if(x.includes("petang")||x==="evening") return "Petang"; if(x.includes("malam")||x==="night") return "Malam"; return value||"—"; }

function injectStyles(){
  const style=document.createElement("style");
  style.textContent=`
    :root{--report-accent:${MODULES[activeModule].color}}
    body{background:#f4f6f5;color:#17211d}.topbar{position:sticky;top:0;z-index:20}.welcome,.summary,.action-centre,.recent,.data-panel{display:none!important}
    #dashboard{max-width:1180px;margin:0 auto;padding:24px}.report-shell{display:grid;gap:18px}.module-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:6px;background:#e9eeeb;border-radius:15px}
    .module-tabs button{border:0;border-radius:11px;padding:12px 8px;background:transparent;font-weight:800;color:#5e6d66}.module-tabs button.active{background:#fff;color:var(--report-accent);box-shadow:0 4px 18px rgba(20,40,30,.09)}
    .builder,.supervisor-card{background:#fff;border:1px solid #dfe6e2;border-radius:18px;padding:18px;box-shadow:0 8px 25px rgba(20,40,30,.04)}.builder-head,.supervisor-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}.eyebrow2{font-size:11px;font-weight:900;letter-spacing:.12em;color:var(--report-accent)}
    .builder h2,.supervisor-card h2{margin:3px 0;font-size:22px}.builder p,.supervisor-card p{margin:0;color:#6a7871;font-size:13px}.filter-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.filter-grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:800;color:#52625b}.filter-grid input,.filter-grid select{width:100%;border:1px solid #ccd7d1;border-radius:10px;padding:11px;background:#fff;font:inherit;color:#18241e}
    .primary-btn,.secondary-btn{border:0;border-radius:11px;padding:12px 15px;font-weight:800;cursor:pointer}.primary-btn{background:var(--report-accent);color:#fff}.secondary-btn{background:#edf2ef;color:#40524a}.builder-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:15px}.load-note{margin-top:9px!important;text-align:right;font-size:11px!important}
    .report-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.report-preview{background:#fff;border:1px solid #d8e0dc;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(20,40,30,.05)}.print-header{display:flex;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:2px solid var(--report-accent)}.print-header small{font-size:9px;font-weight:900;letter-spacing:.08em;color:#5a6d63}.print-header h2{margin:4px 0;font-size:20px}.print-header p{margin:0;color:#607168;font-size:11px}
    .metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:14px 0}.metric{padding:12px;border-radius:10px;background:#f1f7f4;text-align:center}.metric strong{display:block;font-size:22px;color:var(--report-accent)}.metric span{font-size:10px;color:#65766d}.report-section{margin-top:18px}.report-section h3{font-size:13px;margin:0 0 9px}.report-table{width:100%;border-collapse:collapse;font-size:10px}.report-table th,.report-table td{border:1px solid #dde4e0;padding:7px;vertical-align:top}.report-table th{background:#f1f5f3;text-align:left}.num{text-align:right;white-space:nowrap}.bar-row{margin:8px 0}.bar-label{display:flex;justify-content:space-between;gap:12px;font-size:10px}.bar-track{height:7px;margin-top:4px;background:#edf1ef;border-radius:99px;overflow:hidden}.bar-track i{display:block;height:100%;background:var(--report-accent);border-radius:99px}.peak-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.peak-grid article{padding:12px;border:1px solid #dce5e0;border-radius:10px;background:#f8faf9}.peak-grid small,.peak-grid span{display:block;font-size:9px;color:#65766d}.peak-grid strong{display:block;margin:4px 0;font-size:14px;color:#233b31}.signature{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:38px;padding-top:8px}.signature div{border-top:1px solid #333;padding-top:5px;font-size:10px}.signature span{display:block;color:#6d7772;margin-top:3px}.print-footer{margin-top:18px;padding-top:8px;border-top:1px solid #e1e6e3;font-size:8px;color:#7b8781;text-align:center}
    .supervisor-controls{display:grid;grid-template-columns:1fr auto;gap:10px}.supervisor-controls input{border:1px solid #ccd7d1;border-radius:10px;padding:10px}.shift-status{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.shift-pill{padding:10px;border-radius:10px;background:#f3f5f4;text-align:center;font-size:11px}.shift-pill.done{background:#e9f7ef;color:#176b43}.finding-list{display:grid;gap:8px;margin-top:10px}.finding-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:start;padding:11px;border:1px solid #e0e6e3;border-radius:11px}.finding-item small{display:block;color:#708078;margin-top:3px}.finding-actions{display:flex;gap:7px;flex-wrap:wrap}.bulk-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}.empty{padding:18px;border:1px dashed #d5ded9;border-radius:12px;color:#78867f;text-align:center}.status-text{font-size:12px;color:#516159;margin-top:8px}.daily-list{display:grid;gap:7px}.daily-row{display:grid;grid-template-columns:90px 110px 1fr;gap:8px;padding:8px;border-bottom:1px solid #edf0ee;font-size:10px}
    @media(max-width:760px){#dashboard{padding:14px}.module-tabs{grid-template-columns:repeat(2,1fr)}.filter-grid{grid-template-columns:1fr 1fr}.metric-grid{grid-template-columns:1fr 1fr}.peak-grid{grid-template-columns:1fr}.signature{grid-template-columns:1fr;gap:34px}.daily-row{grid-template-columns:75px 90px 1fr}}
    @media print{body{background:#fff}.topbar,.module-tabs,.builder,.supervisor-card,.report-actions{display:none!important}#dashboard{max-width:none;padding:0}.report-preview{border:0;box-shadow:none;padding:0;border-radius:0}.report-shell{display:block}.report-preview{font-size:10pt}@page{size:A4;margin:11mm}.bar-track i,.metric{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `;
  document.head.appendChild(style);
}

function shellHtml(){
  const now=todayParts();
  return `<div class="report-shell">
    <nav class="module-tabs">${Object.entries(MODULES).map(([id,m])=>`<button type="button" data-module="${id}" class="${id===activeModule?"active":""}">${m.label}</button>`).join("")}</nav>
    <section class="builder">
      <div class="builder-head"><div><div class="eyebrow2">PUSAT LAPORAN</div><h2>${MODULES[activeModule].label}</h2><p>Pilih jenis laporan dan tempoh. Data Firebase hanya dibaca selepas Jana Laporan ditekan.</p></div></div>
      <div class="filter-grid">
        <label>Jenis laporan<select id="periodType">${MODULES[activeModule].periods.map(p=>`<option value="${p}">${PERIOD_LABEL[p]}</option>`).join("")}</select></label>
        <label id="dateField">Tarikh<input id="reportDate" type="date" value="${now.date}"></label>
        <label id="monthField" hidden>Bulan<input id="reportMonth" type="month" value="${now.year}-${String(now.month).padStart(2,"0")}"></label>
        <label id="yearField" hidden>Tahun<select id="reportYear">${Array.from({length:7},(_,i)=>now.year-5+i).map(y=>`<option ${y===now.year?"selected":""}>${y}</option>`).join("")}</select></label>
        <label id="weekField" hidden>Minggu dalam bulan<select id="reportWeek"><option value="1">Minggu 1</option><option value="2">Minggu 2</option><option value="3">Minggu 3</option><option value="4">Minggu 4</option><option value="5">Minggu 5</option></select></label>
      </div>
      <div class="builder-actions"><button id="generateBtn" class="primary-btn" type="button">Jana Laporan</button></div><p class="load-note">Tiada statistik berat dimuatkan semasa dashboard dibuka.</p>
    </section>
    ${MODULES[activeModule].supervisor ? supervisorHtml(now.date) : ""}
    <div id="reportHost">${currentReport||`<div class="empty">Pilih tempoh dan tekan <strong>Jana Laporan</strong>.</div>`}</div>
  </div>`;
}

function supervisorHtml(date){ return `<section class="supervisor-card"><div class="supervisor-head"><div><div class="eyebrow2">PENGESAHAN PENYELIA</div><h2>Semakan Harian ${MODULES[activeModule].label}</h2><p>Satu pengesahan sehari untuk keseluruhan 3 shift.</p></div></div><div class="supervisor-controls"><input id="supervisorDate" type="date" value="${date}"><button id="loadSupervisorBtn" class="secondary-btn" type="button">Muat Semakan</button></div><div id="supervisorHost"><div class="empty">Data semakan belum dimuatkan.</div></div></section>`; }

function syncPeriodFields(){ const p=document.querySelector("#periodType")?.value; if(!p)return; document.querySelector("#dateField").hidden=p!=="daily"; document.querySelector("#monthField").hidden=!(p==="monthly"||p==="weekly"); document.querySelector("#yearField").hidden=p!=="yearly"; document.querySelector("#weekField").hidden=p!=="weekly"; }
function bindUI(){
  document.querySelectorAll("[data-module]").forEach(btn=>btn.onclick=()=>{ activeModule=btn.dataset.module; currentReport=""; render(); });
  document.querySelector("#periodType")?.addEventListener("change",syncPeriodFields); syncPeriodFields();
  document.querySelector("#generateBtn")?.addEventListener("click",generateReport);
  document.querySelector("#loadSupervisorBtn")?.addEventListener("click",loadSupervisor);
}
function render(){ document.documentElement.style.setProperty("--report-accent",MODULES[activeModule].color); dashboard.innerHTML=shellHtml(); bindUI(); }

function periodRange(){
  const p=document.querySelector("#periodType").value;
  if(p==="daily"){ const d=document.querySelector("#reportDate").value; return {period:p,from:d,to:d,label:displayDate(d)}; }
  if(p==="yearly"){ const y=Number(document.querySelector("#reportYear").value); return {period:p,from:`${y}-01-01`,to:`${y}-12-31`,label:`Tahun ${y}`}; }
  const [y,m]=document.querySelector("#reportMonth").value.split("-").map(Number);
  const last=new Date(y,m,0).getDate();
  if(p==="monthly") return {period:p,from:`${y}-${String(m).padStart(2,"0")}-01`,to:`${y}-${String(m).padStart(2,"0")}-${last}`,label:`${MONTHS[m-1]} ${y}`};
  const w=Number(document.querySelector("#reportWeek").value); const start=(w-1)*7+1; const end=Math.min(start+6,last); const mm=String(m).padStart(2,"0"); return {period:p,from:`${y}-${mm}-${String(start).padStart(2,"0")}`,to:`${y}-${mm}-${String(end).padStart(2,"0")}`,label:`Minggu ${w}, ${MONTHS[m-1]} ${y}`};
}

async function fetchRange(collectionName,from,to){
  try{
    const snap=await getDocs(query(collection(db,collectionName),where("date",">=",from),where("date","<=",to),limit(5000)));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(error){
    console.warn("Range query fallback",collectionName,error);
    const snap=await getDocs(query(collection(db,collectionName),limit(5000)));
    return snap.docs.map(d=>({id:d.id,...d.data()})).filter(row=>String(row.date||"").slice(0,10)>=from&&String(row.date||"").slice(0,10)<=to);
  }
}
function printActions(label){ return `<div class="report-actions"><strong>${esc(label)}</strong><button class="primary-btn" type="button" onclick="window.print()">Cetak / Simpan PDF</button></div>`; }
function header(title,label){ return `<header class="print-header"><div><small>UNIT KECEMASAN & TRAUMA · HOSPITAL KUALA LIPIS</small><h2>${esc(title)}</h2><p>${esc(label)}</p></div><strong>${esc(MODULES[activeModule].label)}</strong></header>`; }
function signature(){ return `<section class="signature"><div>Disediakan / disemak oleh<span>Nama & tandatangan</span></div><div>Disahkan oleh Penyelia<span>Nama, tandatangan & tarikh</span></div></section>`; }
function footer(){ return `<footer class="print-footer">Dijana daripada AMO Dashboard v2 pada ${esc(new Date().toLocaleString("ms-MY",{timeZone:TZ}))}</footer>`; }

async function generateReport(){
  const btn=document.querySelector("#generateBtn"); const range=periodRange(); btn.disabled=true; btn.textContent="Menjana…";
  try{
    if(activeModule==="procedure") currentReport=await procedureReport(range);
    if(activeModule==="asthma") currentReport=await asthmaReport(range);
    if(activeModule==="phc") currentReport=await phcReport(range);
    if(activeModule==="girn") currentReport=await girnReport(range);
  }catch(error){ console.error(error); currentReport=`<div class="empty">Laporan gagal dijana: ${esc(error.message||error)}</div>`; }
  render();
}

async function procedureReport(range){
  const rows=await fetchRange(COLLECTIONS.procedure,range.from,range.to); const counts=new Map(),hours=new Map(),days=new Map(); let total=0;
  rows.forEach(row=>{ const procs=Array.isArray(row.procedures)?row.procedures:[]; total+=procs.length; const day=String(row.date||"").slice(0,10); if(day)days.set(day,(days.get(day)||0)+procs.length); const h=String(row.time||"").match(/(\d{1,2})[:.](\d{2})/); if(h){const key=String(Number(h[1])).padStart(2,"0");hours.set(key,(hours.get(key)||0)+procs.length)} procs.forEach(p=>{const n=p.name||"Tidak dinyatakan";counts.set(n,(counts.get(n)||0)+1)}); });
  const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]); const max=ranked[0]?.[1]||1; const peakHour=[...hours.entries()].sort((a,b)=>b[1]-a[1])[0]; const peakDay=[...days.entries()].sort((a,b)=>b[1]-a[1])[0];
  const table=ranked.map(([name,c],i)=>`<tr><td>${i+1}</td><td>${esc(name)}</td><td class="num">${c}</td><td class="num">${total?(c/total*100).toFixed(1):"0.0"}%</td></tr>`).join("");
  const bars=ranked.map(([name,c])=>`<div class="bar-row"><div class="bar-label"><span>${esc(name)}</span><strong>${c}</strong></div><div class="bar-track"><i style="width:${Math.max(4,c/max*100)}%"></i></div></div>`).join("");
  return `${printActions(range.label)}<article class="report-preview">${header("Laporan Analisis Prosedur A.M.O",range.label)}<div class="metric-grid"><div class="metric"><strong>${number.format(rows.length)}</strong><span>Kes direkod</span></div><div class="metric"><strong>${number.format(total)}</strong><span>Jumlah prosedur</span></div><div class="metric"><strong>${number.format(ranked.length)}</strong><span>Jenis prosedur</span></div><div class="metric"><strong>${peakHour?`${peakHour[0]}:00`:"—"}</strong><span>Jam paling sibuk</span></div></div><section class="report-section peak-grid"><article><small>Waktu puncak</small><strong>${peakHour?`${peakHour[0]}:00–${peakHour[0]}:59`:"—"}</strong><span>${peakHour?`${peakHour[1]} prosedur`:"Tiada data"}</span></article><article><small>Hari paling banyak prosedur</small><strong>${peakDay?displayDate(peakDay[0]):"—"}</strong><span>${peakDay?`${peakDay[1]} prosedur`:"Tiada data"}</span></article></section><section class="report-section"><h3>Jenis prosedur, jumlah dan peratus</h3><table class="report-table"><thead><tr><th>#</th><th>Prosedur</th><th>Jumlah</th><th>Peratus</th></tr></thead><tbody>${table||`<tr><td colspan="4">Tiada rekod.</td></tr>`}</tbody></table></section><section class="report-section"><h3>Graf prosedur terbanyak → paling sedikit</h3>${bars||`<div class="empty">Tiada data.</div>`}</section>${footer()}</article>`;
}

function pefrDone(row){ if(row.pefrNotDone===true||String(row.pefrNotDone).toLowerCase()==="true")return false; return Number(row.pefrBefore)>0||Number(row.pefrAfter)>0||row.beforePercent!=null||row.afterPercent!=null; }
function isUptriage(row){ const value=String(row.uptriage||"").trim().toLowerCase(); return value && !["none","tiada","false","no"].includes(value); }
async function asthmaReport(range){
  const rows=await fetchRange(COLLECTIONS.asthma,range.from,range.to); const done=rows.filter(pefrDone).length,notDone=rows.length-done,up=rows.filter(isUptriage).length; const pct=x=>rows.length?(x/rows.length*100).toFixed(1):"0.0";
  const daily=rows.slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||String(a.time||"").localeCompare(String(b.time||""))).map(r=>`<div class="daily-row"><span>${displayDate(r.date)}</span><span>${esc(r.time||"—")}</span><span><strong>${esc(r.patientId||r.registrationNumber||"—")}</strong> · ${pefrDone(r)?"PEFR dibuat":"PEFR tidak dapat dibuat"}${isUptriage(r)?` · Uptriage ${esc(r.uptriage)}`:""}</span></div>`).join("");
  const monthly=range.period==="monthly";
  return `${printActions(range.label)}<article class="report-preview">${header(monthly?"Laporan Bulanan Penilaian Asthma":"Laporan Harian Penilaian Asthma",range.label)}<div class="metric-grid"><div class="metric"><strong>${rows.length}</strong><span>Jumlah penilaian</span></div><div class="metric"><strong>${pct(done)}%</strong><span>PEFR dibuat</span></div><div class="metric"><strong>${pct(notDone)}%</strong><span>PEFR tidak dapat dibuat</span></div><div class="metric"><strong>${pct(up)}%</strong><span>Uptriage</span></div></div><section class="report-section"><h3>Data ${monthly?"dalam bulan":"harian"}</h3><div class="daily-list">${daily||`<div class="empty">Tiada rekod.</div>`}</div></section>${monthly?signature():""}${footer()}</article>`;
}

function dedupeOpenFindings(rows,keyFn){ const map=new Map(); rows.forEach(row=>{ const key=keyFn(row); if(!key){map.set(row.id,row);return} const existing=map.get(key); if(!existing){map.set(key,row);return} if(doneStatus(existing.status||existing.state)&&!doneStatus(row.status||row.state))map.set(key,row); }); return [...map.values()]; }
async function phcReport(range){
  const [rows,findingsRaw]=await Promise.all([fetchRange(COLLECTIONS.phc,range.from,range.to),fetchRange(COLLECTIONS.phcFindings,range.from,range.to)]); const findings=dedupeOpenFindings(findingsRaw,r=>`${r.bagShift||r.bag||""}|${r.item||"CATATAN"}|${r.type||"note"}`); const open=findings.filter(r=>!doneStatus(r.status||r.state));
  const shifts=new Map(SHIFTS.map(s=>[s,0])); rows.forEach(r=>{const s=normalizeShift(r.shift);shifts.set(s,(shifts.get(s)||0)+1)}); const frows=findings.map(f=>`<tr><td>${displayDate(f.date)}</td><td>${esc(f.bagShift||f.bag||"—")}</td><td>${esc(f.item||f.note||"Catatan")}</td><td>${esc(f.status||f.state||"Belum diambil tindakan")}</td><td>${esc(f.action||f.actionNote||f.noteAction||"—")}</td></tr>`).join("");
  return `${printActions(range.label)}<article class="report-preview">${header(`Laporan Pemeriksaan PHC · ${PERIOD_LABEL[range.period]}`,range.label)}<div class="metric-grid"><div class="metric"><strong>${rows.length}</strong><span>Pemeriksaan</span></div>${SHIFTS.map(s=>`<div class="metric"><strong>${shifts.get(s)||0}</strong><span>Shift ${s}</span></div>`).join("")}</div><section class="report-section"><h3>Penemuan & tindakan</h3><table class="report-table"><thead><tr><th>Tarikh</th><th>Beg / Shift</th><th>Penemuan</th><th>Status</th><th>Tindakan/Catatan</th></tr></thead><tbody>${frows||`<tr><td colspan="5">Tiada penemuan.</td></tr>`}</tbody></table><p class="status-text">Penemuan terbuka unik: ${open.length}. Penemuan sama yang masih belum selesai dipaparkan sebagai satu isu aktif.</p></section>${range.period==="monthly"?signature():""}${footer()}</article>`;
}

async function girnReport(range){
  const [rows,findingsRaw]=await Promise.all([fetchRange(COLLECTIONS.girn,range.from,range.to),fetchRange(COLLECTIONS.girnFindings,range.from,range.to)]); const findings=dedupeOpenFindings(findingsRaw,r=>`${r.device||r.radio||""}|${r.type||r.inspectionStatus||""}|${r.note||""}`); const open=findings.filter(r=>!doneStatus(r.status||r.state)); const shifts=new Map(SHIFTS.map(s=>[s,0])); rows.forEach(r=>{const s=normalizeShift(r.shift);shifts.set(s,(shifts.get(s)||0)+1)}); const frows=findings.map(f=>`<tr><td>${displayDate(f.date)}</td><td>${esc(f.shift||"—")}</td><td>${esc(f.device||f.radio||f.inspectionStatus||"Penemuan")}</td><td>${esc(f.note||"—")}</td><td>${esc(f.state||f.status||"Belum diambil maklum")}</td></tr>`).join("");
  return `${printActions(range.label)}<article class="report-preview">${header(`Laporan Pemeriksaan GIRN · ${PERIOD_LABEL[range.period]}`,range.label)}<div class="metric-grid"><div class="metric"><strong>${rows.length}</strong><span>Pemeriksaan</span></div>${SHIFTS.map(s=>`<div class="metric"><strong>${shifts.get(s)||0}</strong><span>Shift ${s}</span></div>`).join("")}</div><section class="report-section"><h3>Penemuan & tindakan</h3><table class="report-table"><thead><tr><th>Tarikh</th><th>Shift</th><th>Peralatan</th><th>Catatan</th><th>Status</th></tr></thead><tbody>${frows||`<tr><td colspan="5">Tiada penemuan.</td></tr>`}</tbody></table><p class="status-text">Penemuan terbuka unik: ${open.length}. Isu sama yang belum selesai tidak digandakan dalam laporan.</p></section>${range.period==="monthly"?signature():""}${footer()}</article>`;
}

async function dailyAuditStatus(module,date){ const snap=await getDoc(doc(db,COLLECTIONS.actionTasks,`${module}_daily_${date}`)); return snap.exists()?snap.data():null; }
async function saveDailyVerification(module,date){ await setDoc(doc(db,COLLECTIONS.actionTasks,`${module}_daily_${date}`),{recordType:"daily_verification",module,date,status:"verified",verified:true,verifiedBy:actorName(),verifiedByEmail:sessionUser?.email||"",verifiedUid:sessionUser?.uid||"",verifiedAt:serverTimestamp()},{merge:true}); }

async function loadSupervisor(){
  const host=document.querySelector("#supervisorHost"); const date=document.querySelector("#supervisorDate").value; host.innerHTML=`<div class="empty">Memuatkan semakan…</div>`;
  try{
    if(activeModule==="phc") await loadPhcSupervisor(date,host); else await loadGirnSupervisor(date,host);
  }catch(error){ host.innerHTML=`<div class="empty">Gagal memuatkan: ${esc(error.message||error)}</div>`; }
}

async function loadPhcSupervisor(date,host){
  const [rows,findings,audit]=await Promise.all([fetchRange(COLLECTIONS.phc,date,date),fetchRange(COLLECTIONS.phcFindings,date,date),dailyAuditStatus("phc",date)]); const shifts=new Set(rows.map(r=>normalizeShift(r.shift)).filter(s=>SHIFTS.includes(s))); const notes=findings.filter(f=>f.type!=="shortage"&&String(f.note||"").trim());
  host.innerHTML=`<div class="shift-status">${SHIFTS.map(s=>`<div class="shift-pill ${shifts.has(s)?"done":""}">${s}<br><strong>${shifts.has(s)?"✓ Ada rekod":"Belum lengkap"}</strong></div>`).join("")}</div><div class="bulk-row"><strong>${audit?.verified?`✓ Disahkan oleh ${esc(audit.verifiedBy||"Penyelia")}`:"Belum ada pengesahan harian"}</strong><button id="verifyDayBtn" class="primary-btn" ${shifts.size<3||audit?.verified?"disabled":""}>Sahkan 3 Shift Hari Ini</button></div><section class="report-section"><h3>Catatan untuk perhatian penyelia</h3><div class="finding-list">${notes.length?notes.map(f=>findingCard("phc",f)).join(""):`<div class="empty">Tiada catatan “Tindakan Catatan”. Item restock tidak dihantar ke bahagian penyelia.</div>`}</div></section>`;
  document.querySelector("#verifyDayBtn")?.addEventListener("click",async e=>{e.target.disabled=true;await saveDailyVerification("phc",date);await loadPhcSupervisor(date,host)}); bindFindingActions(host,"phc");
}

async function loadGirnSupervisor(date,host){
  const [rows,findings,audit]=await Promise.all([fetchRange(COLLECTIONS.girn,date,date),fetchRange(COLLECTIONS.girnFindings,date,date),dailyAuditStatus("girn",date)]); const shifts=new Set(rows.map(r=>normalizeShift(r.shift)).filter(s=>SHIFTS.includes(s))); const pending=findings.filter(f=>!doneStatus(f.state||f.status));
  host.innerHTML=`<div class="shift-status">${SHIFTS.map(s=>`<div class="shift-pill ${shifts.has(s)?"done":""}">${s}<br><strong>${shifts.has(s)?"✓ Ada rekod":"Belum lengkap"}</strong></div>`).join("")}</div><div class="bulk-row"><strong>${audit?.verified?`✓ Disahkan oleh ${esc(audit.verifiedBy||"Penyelia")}`:"Belum ada pengesahan harian"}</strong><button id="verifyDayBtn" class="primary-btn" ${shifts.size<3||audit?.verified?"disabled":""}>Sahkan 3 Shift Hari Ini</button></div><section class="report-section"><div class="bulk-row"><label><input id="selectAllFindings" type="checkbox"> Pilih semua penemuan</label><div class="finding-actions"><button id="ackAllBtn" class="secondary-btn">Ambil Maklum Dipilih</button><button id="actionAllBtn" class="primary-btn">Tindakan Selesai Dipilih</button></div></div><div class="finding-list">${pending.length?pending.map(f=>findingCard("girn",f)).join(""):`<div class="empty">Tiada penemuan tertunggak.</div>`}</div></section>`;
  document.querySelector("#verifyDayBtn")?.addEventListener("click",async e=>{e.target.disabled=true;await saveDailyVerification("girn",date);await loadGirnSupervisor(date,host)}); bindFindingActions(host,"girn");
  const selectAll=host.querySelector("#selectAllFindings"); if(selectAll)selectAll.onchange=()=>host.querySelectorAll("[data-finding-check]").forEach(cb=>cb.checked=selectAll.checked);
  host.querySelector("#ackAllBtn")?.addEventListener("click",()=>bulkFindingAction(host,"girn","ack")); host.querySelector("#actionAllBtn")?.addEventListener("click",()=>bulkFindingAction(host,"girn","action"));
}

function findingCard(module,f){ const title=module==="phc"?(f.item||f.bagShift||"Catatan PHC"):(f.device||f.radio||f.inspectionStatus||"Penemuan GIRN"); return `<div class="finding-item"><input data-finding-check type="checkbox" value="${esc(f.id)}"><div><strong>${esc(title)}</strong><small>${esc(f.note||f.action||"Tiada catatan tambahan")} · ${esc(f.status||f.state||"Belum selesai")}</small></div><div class="finding-actions"><button class="secondary-btn" data-find-action="ack" data-id="${esc(f.id)}">Ambil maklum</button>${module==="girn"?`<button class="primary-btn" data-find-action="action" data-id="${esc(f.id)}">Tindakan selesai</button>`:""}</div></div>`; }
function bindFindingActions(host,module){ host.querySelectorAll("[data-find-action]").forEach(btn=>btn.onclick=async()=>{btn.disabled=true;await applyFindingAction(module,btn.dataset.id,btn.dataset.findAction);await loadSupervisor()}); }
async function bulkFindingAction(host,module,mode){ const ids=[...host.querySelectorAll("[data-finding-check]:checked")].map(x=>x.value); if(!ids.length)return alert("Pilih sekurang-kurangnya satu penemuan."); await Promise.all(ids.map(id=>applyFindingAction(module,id,mode))); await loadSupervisor(); }
async function applyFindingAction(module,id,mode){ const col=module==="phc"?COLLECTIONS.phcFindings:COLLECTIONS.girnFindings; const common={actionBy:actorName(),actionByEmail:sessionUser?.email||"",actionAt:serverTimestamp()}; if(module==="phc") await updateDoc(doc(db,col,id),{...common,status:"Telah diambil maklum",acknowledgedBy:actorName(),acknowledgedAt:serverTimestamp()}); else if(mode==="ack") await updateDoc(doc(db,col,id),{...common,state:"Diambil maklum",status:"Diambil maklum",acknowledgedBy:actorName(),acknowledgedAt:serverTimestamp()}); else await updateDoc(doc(db,col,id),{...common,state:"Selesai",status:"Selesai",completedBy:actorName(),completedAt:serverTimestamp()}); }

logoutBtn.addEventListener("click",()=>logout().then(()=>location.href="../"));
prepareAuth();
onAuthStateChanged(auth,async user=>{
  if(!user){ gate.innerHTML=`<h2>Akses penyelia diperlukan</h2><p>Log masuk melalui dashboard utama dahulu.</p><a href="../">Kembali ke dashboard utama</a>`; dashboard.hidden=true; return; }
  sessionUser=user; sessionProfile=await getProfile(user.uid).catch(()=>null);
  if(!isSupervisor(sessionProfile)){ gate.innerHTML=`<h2>Akses tidak dibenarkan</h2><p>Akaun ${esc(user.email||"")} bukan penyelia/admin yang dibenarkan.</p><a href="../">Kembali</a>`; dashboard.hidden=true; return; }
  userLabel.textContent=sessionProfile?.name||user.displayName||user.email; gate.hidden=true; dashboard.hidden=false; injectStyles(); render();
});
