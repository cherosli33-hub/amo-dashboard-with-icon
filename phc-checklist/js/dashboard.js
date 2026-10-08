import { SHIFTS, formatDate, getWeekDays, isoDate, loadFindings, loadLatestInventory, loadPendingSync, loadRecords, loadRestockActions, operationalDate, operationalDateKey, reconcileRemoteRecords, recordLowItems, saveFindings, saveLatestInventory, savePendingSync, saveRestockAction } from "./app.js";
import { apiConfigured, subscribeDashboard, syncPendingInspections, syncPendingRestockActions } from "./api.js";
import { createDashboardLive } from "./dashboard-live.mjs";

const content=document.querySelector("#dashboardContent");
const restockModal=document.querySelector("#restockModal");
let weekDays=[]; let now=new Date(); let today="";
const shortDay=["Isn","Sel","Rab","Kha","Jum","Sab","Ahd"];
let records=loadRecords(); let findings=loadFindings(); let connectionMessage="";

function refreshDateWindow(){
  const previous=today;
  now=new Date(); today=operationalDateKey(now); weekDays=getWeekDays(operationalDate(now));
  return Boolean(previous&&previous!==today);
}
refreshDateWindow();

function recordTimestamp(record){ return new Date(record.savedAt||`${record.date}T${record.time||"00:00"}`).getTime()||0; }
function latestUniqueRecords(items){ const seen=new Set(); return [...items].sort((a,b)=>recordTimestamp(b)-recordTimestamp(a)).filter(record=>{ const key=record.checkKey||`${record.date}|${record.bag}|${record.shift}`; if(seen.has(key)) return false; seen.add(key); return true; }); }
function statusIcon(done){ return `<span class="state-dot ${done?"done":"missing"}">${done?"\u2713":"\u00d7"}</span>`; }
function weekStatus(date){ const dateKey=isoDate(date); if(date>now) return "pending"; return records.some(record=>record.date===dateKey)?"done":"missing"; }
function esc(value=""){ return String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function shortageKey(record,item){ return `${record.id}|${item.name}`; }
function noteActionKey(finding){ return `NOTE|${finding.id}`; }
function newestRecord(items){ return items.filter(Boolean).sort((a,b)=>recordTimestamp(b)-recordTimestamp(a))[0]; }
function noteFinding(record){ return {id:`${record.id}-NOTE`,inspectionId:record.id,date:record.date,bagShift:`${record.bag} / ${record.shift}`,note:record.notes,action:"",actionAt:"",status:"Belum diambil tindakan"}; }
function mergeFindings(remoteFindings,sourceRecords=[],remoteIsAuthoritative=true){
  const base=remoteIsAuthoritative?(remoteFindings||[]):loadFindings();
  const merged=new Map(base.map(finding=>[finding.id,finding]));
  const pendingRecordIds=new Set(loadPendingSync().map(record=>record.id));
  loadFindings().filter(finding=>pendingRecordIds.has(finding.inspectionId)).forEach(finding=>{ if(!merged.has(finding.id)) merged.set(finding.id,finding); });
  sourceRecords.filter(record=>record.notes&&(!remoteIsAuthoritative||pendingRecordIds.has(record.id))).forEach(record=>{ const local=noteFinding(record); if(!merged.has(local.id)) merged.set(local.id,local); });
  return [...merged.values()];
}

function reconcileConfirmedPending(remoteRecords,remoteFindings){
  const pending=loadPendingSync();
  if(!pending.length) return;
  const confirmed=pending.filter(record=>{
    if(!remoteRecords.some(remote=>remote.id===record.id)) return false;
    const shortages=recordLowItems(record);
    const shortagesReady=shortages.every(item=>remoteFindings.some(finding=>finding.type==="shortage"&&finding.inspectionId===record.id&&finding.item===item.name));
    const noteReady=!record.notes||remoteFindings.some(finding=>finding.id===`${record.id}-NOTE`);
    return shortagesReady&&noteReady;
  });
  if(!confirmed.length) return;
  const confirmedIds=new Set(confirmed.map(record=>record.id));
  savePendingSync(pending.filter(record=>!confirmedIds.has(record.id)));
}

function shortageFinding(record,item){
  return findings.find(finding=>finding.type==="shortage"&&finding.inspectionId===record.id&&finding.item===item.name);
}

function currentLowItems(){
  const actions=loadRestockActions();
  const latest=loadLatestInventory();
  const latestByItem=new Map();
  for(const finding of findings){
    if(finding.type!=="shortage"||finding.status!=="Belum diambil tindakan") continue;
    const [bag="",shift=""]=String(finding.bagShift||"").split(" / ");
    const inventory=latest[bag];
    const checked=Object.values(inventory?.quantities||{}).flatMap(group=>group.items||[]).find(item=>item.name===finding.item);
    // A newer checklist is the current stock, while old findings remain in the audit history.
    const source=records.find(record=>record.id===finding.inspectionId);
    const findingTime=source?recordTimestamp(source):new Date(`${finding.date}T00:00`).getTime();
    if(checked&&inventory.id!==finding.inspectionId&&recordTimestamp(inventory)>findingTime&&Number(checked.qty)>=Number(checked.standard)) continue;
    const key=`${finding.inspectionId}|${finding.item}`;
    const synced=Object.values(actions).some(action=>action.findingId===finding.id&&action.syncStatus==="SYNCED");
    if(actions[key]?.syncStatus==="SYNCED"||synced) continue;
    const dedupeKey=`${bag}|${finding.item}`;
    const resolution={key,findingId:finding.id};
    const current=latestByItem.get(dedupeKey);
    if(current){ current.resolutions.push(resolution); continue; }
    latestByItem.set(dedupeKey,{name:finding.item,qty:checked?.qty??finding.qty,standard:checked?.standard??finding.standard,
      bag,shift,date:finding.date,recordId:finding.inspectionId,findingId:finding.id,key,resolutions:[resolution]});
  }
  return [...latestByItem.values()];
}

function queueRestock(items){
  const latest=loadLatestInventory(); const stamp=new Date().toISOString();
  for(const item of items){
    for(const resolution of item.resolutions) saveRestockAction(resolution.key,"Semua stok telah ditambah",{findingId:resolution.findingId,syncStatus:"PENDING"});
    const record=latest[item.bag];
    if(!record) continue;
    const copy=structuredClone(record);
    Object.values(copy.quantities||{}).forEach(group=>(group.items||[]).forEach(stock=>{
      if(stock.name===item.name&&Number(stock.qty)<Number(stock.standard)) stock.qty=stock.standard;
    }));
    copy.savedAt=stamp; saveLatestInventory(copy); latest[item.bag]=copy;
  }
}

function render(){
  const unique=latestUniqueRecords(records); const todayRecords=unique.filter(record=>record.date===today);
  const completed=new Set(todayRecords.map(record=>`${record.bag}-${record.shift}`));
  const expected=[...SHIFTS.map(shift=>`PHC 1-${shift}`),...SHIFTS.map(shift=>`PHC 2-${shift}`)];
  const next=expected.find(key=>!completed.has(key)); const savedLatest=loadLatestInventory();
  const latestInventory=["PHC 1","PHC 2"].map(bag=>newestRecord([savedLatest[bag],...unique.filter(record=>record.bag===bag&&record.quantities)])).filter(Boolean);
  const actions=loadRestockActions();
  const lowItems=currentLowItems();
  const pendingNotes=findings.filter(finding=>finding.type!=="shortage"&&finding.note&&finding.status==="Belum diambil tindakan"&&!actions[noteActionKey(finding)]);
  const bagCard=bag=>`<article class="card bag-card"><div class="bag-title"><span class="bag-badge">\u25a3</span><h3>Beg ${bag}</h3></div><div class="shift-list">${SHIFTS.map(shift=>`<div class="shift-row"><span>${shift}</span>${statusIcon(completed.has(`${bag}-${shift}`))}</div>`).join("")}</div></article>`;
  content.innerHTML=`
    ${hasPending()||connectionMessage?`<div class="connection-banner ${hasPending()?"pending":"info"}"><strong>${hasPending()?"Menunggu sync":"Status sambungan"}</strong><span>${esc(connectionMessage||"Tindakan disimpan pada peranti dan menunggu Firebase.")}</span></div>`:""}
    <section class="date-line"><div><p class="eyebrow">HARI INI</p><h1>${formatDate(now,{weekday:"long",day:"numeric",month:"long"})}</h1></div><span class="live-time" id="liveTime"></span></section>
    <section class="card next-card"><span class="label">TINDAKAN SETERUSNYA</span>${next?`<h2>${next.replace("-"," \u00b7 Shift ")}</h2><p>Pemeriksaan ini masih belum dilengkapkan.</p>`:`<h2>Semua pemeriksaan lengkap</h2><p>Semua beg dan shift sudah disemak hari ini.</p>`}</section>
    <section class="card status-summary"><div class="section-head"><h2>Status Hari Ini</h2><span class="state-dot ${completed.size===6?"done":"pending"}">${completed.size===6?"\u2713":"!"}</span></div><div class="progress-row"><div class="progress-ring" style="--progress:${Math.round(completed.size/6*100)}%"><strong>${completed.size}/6</strong></div><div class="progress-copy"><strong>${completed.size} pemeriksaan selesai</strong><small>2 beg \u00d7 3 shift setiap hari</small></div></div></section>
    <section class="bag-grid">${bagCard("PHC 1")}${bagCard("PHC 2")}</section>
    <section class="action-grid"><button class="card action-card restock-card" id="restockButton"><span class="action-icon">\u26a0</span><span><strong>Restock</strong><small>${lowItems.length} item</small></span><b>\u203a</b></button><button class="card action-card note-card ${pendingNotes.length?"has-pending":""}" id="notesButton"><span class="action-icon">\u270e</span><span><strong>Tindakan Catatan</strong><small>${pendingNotes.length} catatan</small></span>${pendingNotes.length?`<em class="action-badge">${pendingNotes.length}</em>`:""}<b>\u203a</b></button></section>
    <section class="card week-card"><div class="section-head"><h2>Rekod Minggu Ini</h2><a href="records.html">Lihat semua</a></div><div class="week-strip">${weekDays.map((date,i)=>{const status=weekStatus(date); return `<div class="week-day"><span>${shortDay[i]}</span><b class="${status}">${status==="done"?"\u2713":status==="missing"?"\u00d7":"\u2013"}</b></div>`}).join("")}</div></section>
    <button class="primary-cta" onclick="location.href='inspection.html'">\uff0b MULAKAN PEMERIKSAAN</button>`;
  document.querySelector("#restockButton").addEventListener("click",()=>showRestock(lowItems));
  document.querySelector("#notesButton").addEventListener("click",()=>showNoteActions(pendingNotes)); updateClock();
}

function showRestock(lowItems){
  if(!lowItems.length){ alert("Tiada item perlu restock."); return; }
  restockModal.hidden=false;
  restockModal.innerHTML=`<section class="modal restock-modal" role="dialog" aria-modal="true" aria-label="Item perlu restock"><div class="modal-handle"></div><div class="modal-head"><div><p class="eyebrow">AMARAN STOK</p><h2>Item Perlu Restock</h2></div><button class="modal-close" aria-label="Tutup">\u00d7</button></div><p class="restock-help">Tekan \u201cTambah item ini\u201d untuk satu item sahaja, atau \u201cSemua Stok Telah Ditambah\u201d untuk semua sekali.</p><div class="restock-table">${lowItems.map(item=>`<div class="restock-table-row"><div class="restock-summary"><span><strong>${esc(item.name)}</strong><small>Standard ${item.standard} \u00b7 ${item.bag} \u00b7 ${item.shift}</small></span><span class="restock-qty">${item.qty}/${item.standard}</span></div><button class="button ghost restock-one" data-restock-key="${esc(item.key)}" data-restock-finding="${esc(item.findingId)}">\u2713 Tambah item ini</button></div>`).join("")}</div><button class="button primary full restock-all" id="completeAllRestock">\u2713 Semua Stok Telah Ditambah</button></section>`;
}
function showNoteActions(notes){
  if(!notes.length){ alert("Tiada catatan memerlukan tindakan."); return; }
  restockModal.hidden=false;
  restockModal.innerHTML=`<section class="modal note-modal" role="dialog" aria-modal="true" aria-label="Tindakan catatan"><div class="modal-handle"></div><div class="modal-head"><div><p class="eyebrow">CATATAN</p><h2>Tindakan Catatan</h2></div><button class="modal-close" aria-label="Tutup">\u00d7</button></div><p class="restock-help">Pilih satu status bagi setiap catatan.</p><div class="note-action-list">${notes.map(note=>`<article class="note-action-row"><div class="note-meta"><strong>${esc(note.bagShift)}</strong><small>${esc(note.date)}</small></div><p>${esc(note.note)}</p><div class="note-status-buttons"><button data-note-id="${esc(note.id)}" data-note-status="Telah diambil tindakan">Telah diambil tindakan</button><button data-note-id="${esc(note.id)}" data-note-status="Telah diambil maklum">Telah diambil maklum</button></div></article>`).join("")}</div></section>`;
}
function updateClock(){ const el=document.querySelector("#liveTime"); if(el) el.textContent=new Intl.DateTimeFormat("ms-MY",{hour:"2-digit",minute:"2-digit",hour12:true}).format(new Date()); }

function hasPending(){
  return loadPendingSync().length>0||Object.values(loadRestockActions()).some(action=>action.syncStatus!=="SYNCED"&&action.findingId);
}
const live=createDashboardLive({
  subscribe:subscribeDashboard,
  getRange:()=>({from:isoDate(weekDays[0]),to:isoDate(weekDays[6])}),
  isOnline:()=>navigator.onLine,
  hasPending,
  sync:async()=>{
    await Promise.all([syncPendingInspections(),syncPendingRestockActions()]);
    records=loadRecords(); findings=loadFindings(); render();
  },
  onData:(data,{from,to})=>{
    reconcileConfirmedPending(data.records,data.findings);
    data.records.forEach(record=>{ if(record.quantities) saveLatestInventory(record); });
    records=reconcileRemoteRecords(data.records,from,to);
    findings=mergeFindings(data.findings,records.filter(record=>record.date>=from&&record.date<=to),true);
    saveFindings(findings); connectionMessage=""; render();
  },
  onError:()=>{
    connectionMessage="Paparan menggunakan rekod peranti. Sambungan akan dicuba semula."; render();
  }
});

restockModal.addEventListener("click",async event=>{
  if(event.target===restockModal||event.target.closest(".modal-close")){ restockModal.hidden=true; return; }
  const noteButton=event.target.closest("[data-note-status]");
  if(noteButton){
    const status=noteButton.dataset.noteStatus; const findingId=noteButton.dataset.noteId;
    noteButton.closest(".note-status-buttons").querySelectorAll("button").forEach(button=>button.disabled=true);
    noteButton.classList.add("selected"); noteButton.textContent="\u2713 Disimpan";
    saveRestockAction(`NOTE|${findingId}`,status,{findingId,status,syncStatus:"PENDING"});
    findings=findings.map(finding=>finding.id===findingId?{...finding,status}:finding);
    saveFindings(findings); connectionMessage=`Catatan ditanda: ${status}.`;
    setTimeout(()=>{ restockModal.hidden=true; render(); },350);
    syncPendingRestockActions().then(result=>{
      connectionMessage=result.pending?"Status disimpan pada telefon dan akan dihantar semula.":`Catatan ditanda: ${status}.`;
      render();
    }).catch(()=>{ connectionMessage="Status disimpan pada telefon dan akan dihantar semula."; render(); }).finally(()=>live.requestSync(5000));
    return;
  }
  const oneButton=event.target.closest(".restock-one");
  if(oneButton){
    if(!confirm("Item ini telah ditambah ke dalam beg?")) return;
    oneButton.disabled=true; oneButton.textContent="Menyimpan...";
    const key=oneButton.dataset.restockKey; const findingId=oneButton.dataset.restockFinding;
    const selected=currentLowItems().find(item=>item.findingId===findingId&&item.key===key);
    if(!selected){ oneButton.disabled=false; render(); return; }
    queueRestock([selected]);
    restockModal.hidden=true; connectionMessage="Item ditanda. Menghantar tindakan ke Firebase..."; render();
    const resOne=await syncPendingRestockActions().catch(()=>({synced:0,pending:1}));
    live.requestSync(5000);
    connectionMessage=resOne.pending
      ? `Item dikemas kini pada telefon. Tindakan BELUM masuk Firebase${resOne.lastError?` (${resOne.lastError})`:""}. Cuba semula automatik.`
      : `Item direkodkan dalam Firebase sebagai Telah diambil tindakan.`;
    render();
    return;
  }
  const button=event.target.closest("#completeAllRestock"); if(!button) return;
  if(!confirm("Semua item yang disenaraikan telah ditambah ke dalam beg?")) return;
  button.disabled=true; button.textContent="Menyimpan...";
  const activeItems=currentLowItems();
  queueRestock(activeItems);
  restockModal.hidden=true; connectionMessage="Stok dikemas kini. Menghantar tindakan ke Firebase..."; render();
  const result=await syncPendingRestockActions().catch(()=>({synced:0,pending:activeItems.length}));
  live.requestSync(5000);
  connectionMessage=result.pending
    ? `Stok dikemas kini pada telefon. ${result.pending} tindakan BELUM masuk Firebase${result.lastError?` (${result.lastError})`:""}. Cuba semula automatik.`
    : `${result.synced} tindakan direkodkan dalam Firebase sebagai Telah diambil tindakan.`;
  render();
});
function resumeRefresh(){
  refreshDateWindow(); render();
  if(!apiConfigured()){ connectionMessage="Firebase belum disambungkan."; render(); return; }
  live.resume();
}
window.addEventListener("online",resumeRefresh);
window.addEventListener("focus",resumeRefresh);
window.addEventListener("pageshow",resumeRefresh);
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") resumeRefresh(); });
render();
const clockTimer=setInterval(()=>{
  if(refreshDateWindow()){ render(); live.resume(); }
  else updateClock();
},1000);
window.addEventListener("pagehide",()=>{ live.stop(); });
window.addEventListener("beforeunload",()=>{ clearInterval(clockTimer); live.stop(); });
resumeRefresh();
