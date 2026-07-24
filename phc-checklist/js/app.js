import { APP_VERSION } from "./config.js";

export const CATEGORIES = [
  { id:"airway", name:"Airway & Ventilation", icon:"◉", items:[
    ["Nasal cannula (adult)",2],["Nasal cannula (paed)",2],["High flow mask (adult)",2],["High flow mask (paed)",2],["Nebulizer mask (adult)",2],["Nebulizer mask (paed)",2],["Oropharyngeal airway",5],["Nasopharyngeal airway",2],["Bag Valve Mask (adult)",1],["Bag Valve Mask (paed)",1],["BVM tubing",1],["Endotracheal tube size 7.0mm",1],["Endotracheal tube size 6.5mm",1],["Endotracheal tube size 7.5mm",1],["Endotracheal tube size 8.0mm",1],["Endotracheal tube size 5.0mm",1],["Endotracheal tube size 5.5mm",1],["Endotracheal tube size 6.0mm",1],["Stylet (adult)",1],["Stylet (paed)",1],["Laryngeal mask airway size 2",1],["Laryngeal mask airway size 3",1],["Laryngeal mask airway size 4",1],["Laryngoscope handle",1],["Laryngoscope blade size 2",1],["Laryngoscope blade size 3",1],["Laryngoscope blade size 4",1],["Lubrication gel",1],["Anchor tape",1],["10cc Syringe",2]
  ]},
  { id:"iv", name:"IV Access", icon:"✚", items:[
    ["Branula size 16G",4],["Branula size 18G",4],["Branula size 20G",4],["Branula size 22G",4],["Tegaderm",5],["Alcohol swab",20],["Stopper",2],["3cc Syringe",4],["5cc Syringe",4],["10cc Syringe",4],["Needle size 21G",3],["Needle size 23G",3]
  ]},
  { id:"medication", name:"Medication & Drug", icon:"Rx", items:[
    ["Dextrose 50%",5],["Tab. Aspirin",5],["Sublingual GTN (bottle)",1],["Atropine 1mg",3],["Adrenaline 1mg",5],["Tramadol 50mg",4],["Diclofenac sodium 75mg",2],["Chlorpheniramine Maleate 10mg",2],["Metoclopramide 10mg",2],["Hydrocortisone 100mg",4],["Haloperidol 10mg",2],["Combivent solution",5],["Atrovent solution",5],["Salbutamol solution (bottle)",1],["Water for Injection",5],["Heparin saline",5]
  ]},
  { id:"drip", name:"IV Drip", icon:"滴", items:[
    ["Normal saline 0.9%",1],["Dextrose 10%",1],["Drip set tubing (adult)",1]
  ]},
  { id:"dxt", name:"Dextrostix Kit", icon:"DXT", phc1Only:true, items:[
    ["Dextrostix machine",1],["Dextrostix strips (bottle)",1],["Lancet",10]
  ]},
  { id:"wound", name:"Wound Management", icon:"✥", items:[
    ["Adhesive tape / micropore (roll)",1],["Gauze pack",5],["Cotton pack",5],["Gamgee pack",3],["Arm sling",4],["Crepe bandage 10cm (roll)",3],["Crepe bandage 6cm (roll)",3],["Commercial tourniquet",1]
  ]},
  { id:"personal", name:"Personal Equipment", icon:"▣", items:[
    ["Rescue scissor",1],["Torchlight",1],["Stethoscope",1],["Sterile glove",3],["Chest leads",15],["Spider strapping",1]
  ]}
];

export const SHIFTS = ["Pagi","Petang","Malam"];
export const STORAGE_KEY = "phcProductionRecords";
export const LATEST_INVENTORY_KEY = "phcProductionLatestInventory";
export const PENDING_SYNC_KEY = "phcPendingSync";
export const RESTOCK_ACTIONS_KEY = "phcRestockActions";
export const FINDINGS_KEY = "phcFindings";

export function categoriesForBag(bag){ return CATEGORIES.filter(category => bag === "PHC 1" || !category.phc1Only); }
export function startOfWeek(input=new Date()){ const d=new Date(input); const day=d.getDay() || 7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day+1); return d; }
export function isoDate(date){ const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,"0"); const d=String(date.getDate()).padStart(2,"0"); return `${y}-${m}-${d}`; }
export function formatDate(date, options={weekday:"long",day:"numeric",month:"long",year:"numeric"}){ return new Intl.DateTimeFormat("ms-MY",options).format(date); }
export function loadRecords(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
export function saveRecords(records){ localStorage.setItem(STORAGE_KEY,JSON.stringify(records)); }
export function upsertLocalRecord(record){ const records=loadRecords(); const index=records.findIndex(item=>item.id===record.id); if(index>=0) records[index]=record; else records.unshift(record); saveRecords(records.slice(0,500)); return records; }
export function reconcileRemoteRecords(remoteRecords,from,to){
  const pendingIds=new Set(loadPendingSync().map(record=>record.id));
  const retained=loadRecords().filter(record=>record.date<from||record.date>to||pendingIds.has(record.id));
  const merged=[]; const seen=new Set();
  [...(remoteRecords||[]),...retained].forEach(record=>{ if(record?.id&&!seen.has(record.id)){ seen.add(record.id); merged.push(record); } });
  saveRecords(merged.slice(0,500)); return merged;
}
export function loadLatestInventory(){ try { return JSON.parse(localStorage.getItem(LATEST_INVENTORY_KEY)) || {}; } catch { return {}; } }
function recordTime(record){ return new Date(record?.savedAt||`${record?.date||""}T${record?.time||"00:00"}`).getTime()||0; }
export function saveLatestInventory(record){
  const latest=loadLatestInventory(); const current=latest[record.bag];
  if(!current || recordTime(record)>=recordTime(current)) latest[record.bag]=record;
  localStorage.setItem(LATEST_INVENTORY_KEY,JSON.stringify(latest));
}
export function loadRestockActions(){ try { return JSON.parse(localStorage.getItem(RESTOCK_ACTIONS_KEY)) || {}; } catch { return {}; } }
export function saveRestockAction(key, action, details={}){ const actions=loadRestockActions(); actions[key]={...actions[key],...details,action:String(action||"").trim(),completedAt:actions[key]?.completedAt||new Date().toISOString()}; localStorage.setItem(RESTOCK_ACTIONS_KEY,JSON.stringify(actions)); return actions[key]; }
export function loadFindings(){ try { return JSON.parse(localStorage.getItem(FINDINGS_KEY)) || []; } catch { return []; } }
export function saveFindings(findings){ localStorage.setItem(FINDINGS_KEY,JSON.stringify(Array.isArray(findings)?findings:[])); }
export function loadPendingSync(){ try { return JSON.parse(localStorage.getItem(PENDING_SYNC_KEY)) || []; } catch { return []; } }
export function savePendingSync(records){ localStorage.setItem(PENDING_SYNC_KEY,JSON.stringify(records)); }
export function getWeekDays(){ const monday=startOfWeek(); return Array.from({length:7},(_,i)=>{ const d=new Date(monday); d.setDate(monday.getDate()+i); return d; }); }
export function recordLowItems(record){ if(!record?.quantities) return []; return Object.values(record.quantities).flatMap(category => category.items || []).filter(item => item.qty < item.standard); }

export function registerServiceWorker(){
  if(typeof navigator==="undefined"||!("serviceWorker" in navigator)||location.protocol==="file:") return;
  let refreshing=false; let registration;
  const inspectionInProgress=()=>document.body?.dataset.page==="inspection"&&Boolean(document.querySelector(".checklist, #saveInspection"));
  const reloadLatest=version=>{
    if(refreshing) return;
    if(inspectionInProgress()){
      try{ sessionStorage.setItem("phcUpdatePending",String(version||APP_VERSION)); }catch{}
      return;
    }
    refreshing=true;
    const url=new URL(location.href); url.searchParams.set("app",String(version||Date.now()));
    location.replace(url.toString());
  };
  const remoteVersion=async()=>{
    const response=await fetch(`./js/config.js?update=${Date.now()}`,{cache:"no-store"});
    if(!response.ok) return "";
    const source=await response.text();
    return source.match(/APP_VERSION\s*=\s*["']([^"']+)/)?.[1]||"";
  };
  const checkForUpdate=async()=>{
    if(!navigator.onLine) return;
    try{
      if(registration) await registration.update();
      const latest=await remoteVersion();
      if(latest&&latest!==APP_VERSION) reloadLatest(latest);
    }catch{}
  };
  navigator.serviceWorker.addEventListener("controllerchange",()=>reloadLatest());
  navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{updateViaCache:"none"}).then(value=>{
    registration=value;
    registration.addEventListener("updatefound",()=>{
      const worker=registration.installing;
      worker?.addEventListener("statechange",()=>{ if(worker.state==="installed"&&navigator.serviceWorker.controller) reloadLatest(); });
    });
    checkForUpdate();
    setInterval(checkForUpdate,60000);
  }).catch(()=>{});
  ["online","focus","pageshow"].forEach(name=>window.addEventListener(name,checkForUpdate));
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") checkForUpdate(); });
}
registerServiceWorker();
