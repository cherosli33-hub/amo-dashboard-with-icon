const style=document.createElement("style");
style.textContent=`.amo-weekly{margin-bottom:16px}.amo-weekly-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.amo-weekly-grid div{padding:12px;border-radius:10px;background:#f3f8f6}.amo-weekly-grid strong,.amo-weekly-grid small{display:block}.amo-weekly-grid strong{margin-top:4px;font-size:22px;color:#116e5e}.amo-live-note{position:fixed;right:18px;bottom:18px;z-index:9999;padding:11px 14px;border-radius:10px;background:#073f39;color:#fff;box-shadow:0 8px 25px #0002;font-size:13px}.amo-central-action-note{margin:10px 0;padding:10px 12px;border-radius:9px;background:#eef7f4;color:#185f55;font-size:12px;font-weight:700}@media(max-width:650px){.amo-weekly-grid{grid-template-columns:1fr 1fr}}`;
document.head.appendChild(style);
if(!document.body) await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));

let dashboardData=null;
let loadingData=null;
async function readDashboard(){
  if(dashboardData) return dashboardData;
  if(!loadingData) loadingData=window.AMOFirebaseRequest({module:"girn",action:"dashboard"}).then(value=>(dashboardData=value)).finally(()=>{loadingData=null;});
  return loadingData;
}

function dateKey(date){ return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function startOfWeek(date=new Date()){ const result=new Date(date); const day=(result.getDay()+6)%7; result.setHours(0,0,0,0); result.setDate(result.getDate()-day); return result; }

async function addWeeklyAudit(){
  const heading=[...document.querySelectorAll("h2")].find(node=>node.textContent.includes("Audit & Pematuhan"));
  const section=heading ? [...document.querySelectorAll("section")].find(node=>node.textContent.includes("Ringkasan audit bulanan")) : null;
  if(!section||section.querySelector(".amo-weekly")) return;
  const panel=document.createElement("article"); panel.className="panel amo-weekly";
  panel.innerHTML='<span class="section-kicker">MINGGU INI</span><h3>Ringkasan audit mingguan</h3><p>Memuatkan data Firebase…</p>';
  section.prepend(panel);
  try{
    const data=await readDashboard();
    const start=startOfWeek(); const end=new Date(start); end.setDate(start.getDate()+6);
    const from=dateKey(start),to=dateKey(end);
    const inspections=(data.inspections||[]).filter(item=>item.date>=from&&item.date<=to);
    const findings=(data.findings||[]).filter(item=>item.date>=from&&item.date<=to);
    const days=new Map(); inspections.forEach(item=>{ if(!days.has(item.date))days.set(item.date,new Set()); days.get(item.date).add(item.shift); });
    const elapsed=Math.min(7,Math.max(1,Math.floor((new Date()-start)/86400000)+1));
    const compliant=[...days.values()].filter(shifts=>shifts.size>=2).length;
    panel.innerHTML=`<span class="section-kicker">MINGGU INI · ${from} hingga ${to}</span><h3>Ringkasan audit mingguan</h3><div class="amo-weekly-grid"><div><small>Pemeriksaan</small><strong>${inspections.length}</strong></div><div><small>Hari patuh</small><strong>${compliant}/${elapsed}</strong></div><div><small>Pematuhan</small><strong>${(compliant/elapsed*100).toFixed(1)}%</strong></div><div><small>Penemuan</small><strong>${findings.length}</strong></div></div>`;
  }catch(error){ panel.querySelector("p").textContent=error.message||"Data mingguan gagal dimuatkan."; }
}

function removeLocalSupervisorActions(){
  const actionWords=["ambil maklum","diambil maklum","tandakan selesai","sahkan","selesaikan penemuan"];
  document.querySelectorAll("button").forEach(button=>{
    const text=String(button.textContent||"").trim().toLocaleLowerCase("ms-MY");
    if(actionWords.some(word=>text.includes(word))){ button.remove(); }
  });
  const findingsHeading=[...document.querySelectorAll("h2,h3")].find(node=>String(node.textContent||"").toLocaleLowerCase("ms-MY").includes("penemuan"));
  const host=findingsHeading?.parentElement;
  if(host&&!host.querySelector(".amo-central-action-note")){
    const note=document.createElement("p");
    note.className="amo-central-action-note";
    note.textContent="Pengesahan dan ambil maklum penemuan dibuat di Dashboard Penerima.";
    host.appendChild(note);
  }
}

// Tindakan penyelia sengaja tidak lagi dibuat dalam app GIRN.
// Penemuan kekal boleh dilihat, tetapi tindakan dibuat di Dashboard Penerima.
const observer=new MutationObserver(()=>{ void addWeeklyAudit(); removeLocalSupervisorActions(); });
observer.observe(document.body,{childList:true,subtree:true});
void addWeeklyAudit(); removeLocalSupervisorActions();

let initialStreams=0;
let reloadTimer=null;
function liveChanged(){
  initialStreams+=1;
  if(initialStreams<=2) return;
  dashboardData=null;
  const activeHeading=[...document.querySelectorAll("h2")].find(node=>["Pemeriksaan GIRN"].includes(node.textContent.trim()));
  if(activeHeading) return;
  clearTimeout(reloadTimer);
  reloadTimer=setTimeout(()=>{
    const note=document.createElement("div"); note.className="amo-live-note"; note.textContent="Data baharu diterima · mengemas kini paparan…"; document.body.appendChild(note);
    setTimeout(()=>location.reload(),500);
  },350);
}
const stops=[window.AMOSubscribe?.("girn",liveChanged,console.error),window.AMOSubscribe?.("girnFindings",liveChanged,console.error)].filter(Boolean);
window.addEventListener("beforeunload",()=>{observer.disconnect();stops.forEach(stop=>stop());});

function fastPrint(){
  document.documentElement.classList.add("print-preparing");
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    window.print();
    document.documentElement.classList.remove("print-preparing");
  }));
}

// Pintasan cetak disediakan selepas paparan semasa sempat dicat, supaya dialog
// sistem tidak tersekat oleh kemas kini React dan pengiraan audit pada klik sama.
document.addEventListener("click",event=>{
  const button=event.target.closest?.("button");
  if(!button||!/cetak laporan/i.test(button.textContent||"")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  fastPrint();
},true);
