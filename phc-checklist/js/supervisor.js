import { GOOGLE_OAUTH_CLIENT_ID } from "./config.js";
import { fetchSupervisorRecords, supervisorSession, verifyInspections } from "./api.js";
import { formatDate, getWeekDays, isoDate, recordLowItems } from "./app.js";

const root=document.querySelector("#supervisorRoot"); const modal=document.querySelector("#supervisorModal");
const TOKEN_KEY="phcSupervisorIdToken"; let idToken=sessionStorage.getItem(TOKEN_KEY)||""; let supervisor=null; let records=[]; let selected=new Set();
const week=getWeekDays(); let from=isoDate(week[0]); let to=isoDate(week[6]);
function esc(value=""){return String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function waitForGoogle(){return new Promise((resolve,reject)=>{let count=0;const timer=setInterval(()=>{if(window.google?.accounts?.id){clearInterval(timer);resolve();}else if(++count>80){clearInterval(timer);reject(new Error("Perkhidmatan log masuk Google tidak dapat dimuatkan."));}},100);});}

function renderLogin(message=""){
  root.innerHTML=`<section class="card supervisor-login"><span class="supervisor-shield">♜</span><h1>Akses Admin / Penyelia</h1><p>Log masuk menggunakan akaun Google admin atau penyelia yang telah didaftarkan.</p>${message?`<div class="connection-banner pending"><strong>Log masuk gagal</strong><span>${esc(message)}</span></div>`:""}<div id="googleButton"></div><small>Kata laluan Google tidak dihantar atau disimpan oleh PHC Checklist.</small></section>`;
  if(!GOOGLE_OAUTH_CLIENT_ID){root.querySelector("#googleButton").innerHTML=`<div class="connection-banner pending"><strong>OAuth belum dikonfigurasi</strong><span>Masukkan GOOGLE_OAUTH_CLIENT_ID sebelum ujian login.</span></div>`;return;}
  google.accounts.id.initialize({client_id:GOOGLE_OAUTH_CLIENT_ID,callback:handleCredential,auto_select:true,cancel_on_tap_outside:false});
  google.accounts.id.renderButton(document.querySelector("#googleButton"),{theme:"outline",size:"large",shape:"pill",text:"signin_with",width:280});
}

async function handleCredential(response){idToken=response.credential||"";sessionStorage.setItem(TOKEN_KEY,idToken);await openSession();}
async function openSession(){
  try{const result=await supervisorSession(idToken);supervisor=result.supervisor;await loadRecords();}
  catch(error){idToken="";supervisor=null;sessionStorage.removeItem(TOKEN_KEY);renderLogin(error.message);}
}
async function loadRecords(){
  root.innerHTML=`<section class="card empty-state"><span>↻</span><h3>Memuatkan rekod</h3></section>`;
  try{const result=await fetchSupervisorRecords(idToken,from,to);supervisor=result.supervisor;records=Array.isArray(result.records)?result.records:[];selected=new Set(records.filter(r=>!r.verified).map(r=>r.id));renderSupervisor();}
  catch(error){if(/sesi|log masuk|akses/i.test(error.message)){idToken="";sessionStorage.removeItem(TOKEN_KEY);renderLogin(error.message);}else root.innerHTML=`<div class="connection-banner pending"><strong>Rekod tidak dapat dimuatkan</strong><span>${esc(error.message)}</span></div>`;}
}

function renderSupervisor(){
  const unverified=records.filter(r=>!r.verified); const verified=records.length-unverified.length;
  const modeLabel=/admin/i.test(supervisor.role||"")?"MOD ADMIN":"MOD PENYELIA";
  root.innerHTML=`<section class="supervisor-welcome"><div><p class="eyebrow">${modeLabel}</p><h1>${esc(supervisor.name)}</h1><small>${esc(supervisor.role||"")}</small></div><button class="button ghost compact" id="logout">Log keluar</button></section><section class="card supervisor-filter"><label>Dari<input type="date" id="fromDate" value="${from}"></label><label>Hingga<input type="date" id="toDate" value="${to}"></label><button class="button secondary" id="applyDates">Papar</button></section><section class="record-stats"><div class="card mini-stat"><strong>${unverified.length}</strong><span>BELUM DISAHKAN</span></div><div class="card mini-stat"><strong>${verified}</strong><span>SUDAH DISAHKAN</span></div></section><div class="supervisor-actions"><label><input type="checkbox" id="selectAll" ${unverified.length&&selected.size===unverified.length?"checked":""}> Pilih semua belum disahkan</label><button class="button primary" id="verifySelected" ${selected.size?"":"disabled"}>✓ Sahkan ${selected.size} rekod</button></div><section class="supervisor-records">${records.length?records.map(supervisorCard).join(""):`<div class="card empty-state"><span>▢</span><h3>Tiada rekod</h3><p>Tiada pemeriksaan dalam tempoh dipilih.</p></div>`}</section>`;
}
function supervisorCard(record){const low=recordLowItems(record).length;return `<article class="card supervisor-record ${record.verified?"is-verified":""}"><input type="checkbox" data-select="${esc(record.id)}" ${selected.has(record.id)?"checked":""} ${record.verified?"disabled":""}><div><strong>${esc(record.bag)} · ${esc(record.shift)}</strong><small>${formatDate(new Date(`${record.date}T12:00:00`),{day:"numeric",month:"short",year:"numeric"})} · ${esc(record.ppp)} · ${low?`${low} item kurang`:"Lengkap"}</small>${record.verified?`<span class="verified-badge">✓ ${esc(record.verifiedBy)}</span>`:""}</div></article>`;}

root.addEventListener("click",async event=>{
  if(event.target.id==="logout"){sessionStorage.removeItem(TOKEN_KEY);idToken="";supervisor=null;google.accounts.id.disableAutoSelect();renderLogin();return;}
  if(event.target.id==="applyDates"){from=document.querySelector("#fromDate").value;to=document.querySelector("#toDate").value;if(!from||!to||from>to){alert("Julat tarikh tidak sah.");return;}await loadRecords();return;}
  if(event.target.id==="verifySelected"){showConfirm();return;}
});
root.addEventListener("change",event=>{if(event.target.id==="selectAll"){selected=event.target.checked?new Set(records.filter(r=>!r.verified).map(r=>r.id)):new Set();renderSupervisor();return;}const box=event.target.closest("[data-select]");if(box){box.checked?selected.add(box.dataset.select):selected.delete(box.dataset.select);renderSupervisor();}});
function showConfirm(){modal.hidden=false;modal.innerHTML=`<section class="modal"><div class="modal-handle"></div><div class="modal-head"><h2>Sahkan rekod?</h2><button class="modal-close">×</button></div><p class="confirm-copy">Anda akan mengesahkan <strong>${selected.size} rekod</strong> bagi ${formatDate(new Date(`${from}T12:00:00`),{day:"numeric",month:"short"})} hingga ${formatDate(new Date(`${to}T12:00:00`),{day:"numeric",month:"short",year:"numeric"})}. Tindakan direkodkan atas nama ${esc(supervisor.name)}.</p><button class="button primary full" id="confirmVerify">✓ Ya, sahkan rekod</button></section>`;}
modal.addEventListener("click",async event=>{if(event.target===modal||event.target.closest(".modal-close")){modal.hidden=true;return;}if(event.target.id!=="confirmVerify")return;event.target.disabled=true;event.target.textContent="Mengesahkan...";try{const result=await verifyInspections(idToken,[...selected]);modal.hidden=true;alert(`${result.verified} rekod berjaya disahkan.`);await loadRecords();}catch(error){event.target.disabled=false;event.target.textContent="✓ Cuba semula";alert(error.message);}});

waitForGoogle().then(()=>idToken?openSession():renderLogin()).catch(error=>renderLogin(error.message));
