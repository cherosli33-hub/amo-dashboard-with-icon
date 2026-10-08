import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createDashboardLive } from "../phc-checklist/js/dashboard-live.mjs";

const appSource=await readFile(new URL("../phc-checklist/js/app.js",import.meta.url),"utf8");
const dashboardSource=await readFile(new URL("../phc-checklist/js/dashboard.js",import.meta.url),"utf8");
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function harness(){
  const elements=new Map(),events=new Map(),storage=new Map(),timers=new Map();let timerId=0,subscription,syncs=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:"",hidden:true,textContent:"",handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});return elements.get(id);};
  const schedule=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;};
  class Clock extends Date{static instant=new Date(2026,9,8,12,0,0).getTime();constructor(...args){super(...(args.length?args:[Clock.instant]));}static now(){return Clock.instant;}}
  const context=vm.createContext({console,Intl,Date:Clock,structuredClone,URL,APP_VERSION:"test",confirm:()=>true,alert:()=>{},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    navigator:{onLine:true},location:{protocol:"http:"},
    window:{addEventListener:(name,fn)=>events.set(name,fn)},
    document:{querySelector:element,addEventListener:(name,fn)=>events.set(name,fn)},
    setTimeout:schedule,clearTimeout:id=>timers.delete(id),setInterval:schedule,clearInterval:id=>timers.delete(id),
    createDashboardLive:options=>createDashboardLive({...options,schedule,cancel:id=>timers.delete(id)}),
    apiConfigured:()=>true,
    subscribeDashboard:(from,to,next,error)=>{subscription={from,to,next,error,stopped:false};return()=>{subscription.stopped=true;};},
    syncPendingInspections:async()=>({synced:0,pending:0}),
    syncPendingRestockActions:async()=>{
      syncs++;const actions=context.loadRestockActions();
      if(!context.navigator.onLine)return {synced:0,pending:Object.keys(actions).length};
      for(const [key,action]of Object.entries(actions))context.saveRestockAction(key,action.action,{...action,syncStatus:"SYNCED"});
      return {synced:Object.keys(actions).length,pending:0};
    }
  });
  const names=[...appSource.matchAll(/export (?:const|function) (\w+)/g)].map(match=>match[1]);
  vm.runInContext(appSource.replace(/^import .*;\r?\n/gm,"").replace(/\bexport /g,"")+`\nObject.assign(globalThis,{${names.join(",")}});`,context);
  function start(){vm.runInContext(dashboardSource.replace(/^import .*;\r?\n/gm,""),context);}
  const fixture={id:"inspection",date:"2026-10-08",time:"09:00",savedAt:"2026-10-08T09:00:00+08:00",bag:"PHC 1",shift:"Pagi",ppp:"Test Staff",quantities:{airway:{items:[{name:"Test item",qty:0,standard:2}]}}};
  return {context,start,fixture,elements,events,timers,get subscription(){return subscription;},get syncs(){return syncs;},html:()=>element("#dashboardContent").innerHTML,modal:()=>element("#restockModal"),element};
}
test("cached dashboard paints immediately; live inspection preserves layout and updates status",()=>{
  const h=harness();h.context.upsertLocalRecord(h.fixture);h.start();
  assert.match(h.html(),/1\/6/);assert.match(h.html(),/Status Hari Ini/);assert.match(h.html(),/Rekod Minggu Ini/);
  assert.equal(h.subscription.from,"2026-10-05");assert.equal(h.subscription.to,"2026-10-11");
  h.subscription.next({records:[h.fixture,{...h.fixture,id:"second",bag:"PHC 2"}],findings:[]});
  assert.match(h.html(),/2\/6/);assert.match(h.html(),/MULAKAN PEMERIKSAAN/);
  h.events.get("pagehide")();assert.equal(h.subscription.stopped,true);
});
test("old unresolved shortage and note keep the original Restock and Tindakan Catatan controls",()=>{
  const h=harness();h.start();
  h.subscription.next({records:[],findings:[{id:"older-shortage",inspectionId:"old",date:"2026-09-01",type:"shortage",item:"Test item",qty:0,standard:2,bagShift:"PHC 1 / Pagi",status:"Belum diambil tindakan"},{id:"older-note",date:"2026-09-01",type:"note",note:"Test note",bagShift:"PHC 2 / Malam",status:"Belum diambil tindakan"}]});
  assert.match(h.html(),/Restock<\/strong><small>1 item/);assert.match(h.html(),/Tindakan Catatan<\/strong><small>1 catatan/);
  h.element("#restockButton").handlers.click();assert.match(h.modal().innerHTML,/Tambah item ini/);assert.match(h.modal().innerHTML,/Semua Stok Telah Ditambah/);
  h.element("#notesButton").handlers.click();assert.match(h.modal().innerHTML,/Telah diambil maklum/);
  h.subscription.next({records:[],findings:[]});assert.match(h.html(),/Restock<\/strong><small>0 item/);h.events.get("pagehide")();
});
test("restock click retains local inventory and queue offline; reconnect sends without polling reads",async()=>{
  const h=harness();h.start();h.context.navigator.onLine=false;
  const finding={id:"shortage",inspectionId:"inspection",date:"2026-10-08",type:"shortage",item:"Test item",qty:0,standard:2,bagShift:"PHC 1 / Pagi",status:"Belum diambil tindakan"};
  h.subscription.next({records:[h.fixture],findings:[finding]});
  const button={dataset:{restockKey:"inspection|Test item",restockFinding:"shortage"},disabled:false,textContent:""};
  await h.modal().handlers.click({target:{closest:selector=>selector===".restock-one"?button:null}});
  assert.equal(h.context.loadLatestInventory()["PHC 1"].quantities.airway.items[0].qty,2);
  assert.equal(h.context.loadRestockActions()["inspection|Test item"].syncStatus,"PENDING");
  h.context.navigator.onLine=true;h.events.get("online")();
  const pending=[...h.timers.entries()].find(([,timer])=>timer.delay===0);assert.ok(pending);h.timers.delete(pending[0]);pending[1].fn();await tick();
  assert.equal(h.context.loadRestockActions()["inspection|Test item"].syncStatus,"SYNCED");
  assert.equal(h.subscription.stopped,false);h.events.get("pagehide")();
});
test("both note statuses keep their existing local action and cloud-sync path",async()=>{
  for(const status of ["Telah diambil tindakan","Telah diambil maklum"]){
    const h=harness();h.start();h.subscription.next({records:[],findings:[{id:"note",date:"2026-10-08",type:"note",note:"Test note",status:"Belum diambil tindakan"}]});
    const button={dataset:{noteId:"note",noteStatus:status},classList:{add:()=>{}},closest:()=>({querySelectorAll:()=>[button]})};
    await h.modal().handlers.click({target:{closest:selector=>selector==="[data-note-status]"?button:null}});await tick();
    const action=h.context.loadRestockActions()["NOTE|note"];
    assert.equal(action.status,status);assert.equal(action.syncStatus,"SYNCED");assert.equal(h.syncs,1);h.events.get("pagehide")();
  }
});
test("all-restock keeps both item resolutions and restores the cached quantities",async()=>{
  const h=harness();h.start();h.subscription.next({records:[h.fixture],findings:[{id:"shortage",inspectionId:"inspection",date:"2026-10-08",type:"shortage",item:"Test item",qty:0,standard:2,bagShift:"PHC 1 / Pagi",status:"Belum diambil tindakan"}]});
  const button={disabled:false,textContent:""};
  await h.modal().handlers.click({target:{closest:selector=>selector==="#completeAllRestock"?button:null}});
  assert.equal(h.context.loadRestockActions()["inspection|Test item"].syncStatus,"SYNCED");
  assert.equal(h.context.loadLatestInventory()["PHC 1"].quantities.airway.items[0].qty,2);h.events.get("pagehide")();
});
test("local operational-week clock changes listener range without a cloud refresh request",()=>{
  const h=harness();h.start();const old=h.subscription;
  h.context.Date.instant+=7*86400000;
  [...h.timers.values()].find(timer=>timer.delay===1000).fn();
  assert.equal(old.stopped,true);assert.equal(h.subscription.from,"2026-10-12");assert.equal(h.subscription.to,"2026-10-18");h.events.get("pagehide")();
});
