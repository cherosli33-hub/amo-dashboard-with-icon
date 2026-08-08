const style=document.createElement("style");
style.textContent=`.amo-bulk-ack{margin-left:8px;padding:9px 13px;border:0;border-radius:9px;background:#0b7568;color:#fff;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.amo-bulk-ack:disabled{opacity:.55}.amo-weekly{margin-bottom:16px}.amo-weekly-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.amo-weekly-grid div{padding:12px;border-radius:10px;background:#f3f8f6}.amo-weekly-grid strong,.amo-weekly-grid small{display:block}.amo-weekly-grid strong{margin-top:4px;font-size:22px;color:#116e5e}.amo-live-note{position:fixed;right:18px;bottom:18px;z-index:9999;padding:11px 14px;border-radius:10px;background:#073f39;color:#fff;box-shadow:0 8px 25px #0002;font-size:13px}@media(max-width:650px){.amo-weekly-grid{grid-template-columns:1fr 1fr}.amo-bulk-ack{width:100%;margin:8px 0 0}}`;
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

async function acknowledgeAll(button){
  const officer=prompt("Masukkan nama pegawai yang mengambil maklum semua penemuan:");
  if(!officer?.trim()) return;
  const data=await readDashboard();
  const open=(data.findings||[]).filter(item=>item.state==="Baharu");
  if(!open.length){ alert("Tiada penemuan baharu."); return; }
  if(!confirm(`Tandakan ${open.length} penemuan sebagai telah diambil maklum oleh ${officer.trim()}?`)) return;
  button.disabled=true; button.textContent="Menyimpan…";
  const stamp=new Date().toISOString();
  try{
    for(const finding of open){
      await window.AMOFirebaseRequest({module:"girn",action:"updateFinding",body:{action:"updateFinding",finding:{...finding,state:"Diambil maklum",acknowledgedBy:officer.trim(),acknowledgedAt:stamp}}});
    }
    location.reload();
  }catch(error){ alert(error.message||"Tindakan pukal gagal disimpan."); button.disabled=false; button.textContent="✓ Semua telah diambil maklum"; }
}

function addBulkAction(){
  const heading=[...document.querySelectorAll("h3")].find(node=>node.textContent.includes("Susulan penemuan"));
  const area=heading?.closest(".intro-row");
  if(!area||area.querySelector(".amo-bulk-ack")) return;
  const button=document.createElement("button"); button.type="button"; button.className="amo-bulk-ack"; button.textContent="✓ Semua telah diambil maklum";
  button.addEventListener("click",()=>acknowledgeAll(button)); area.appendChild(button);
}

const observer=new MutationObserver(()=>{ addBulkAction(); void addWeeklyAudit(); });
observer.observe(document.body,{childList:true,subtree:true});
addBulkAction(); void addWeeklyAudit();

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
