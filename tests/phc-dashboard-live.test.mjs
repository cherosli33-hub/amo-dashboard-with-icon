import test from "node:test";
import assert from "node:assert/strict";
import { subscribeDashboard } from "../shared/firebase/phc-dashboard-source.mjs";
import { createDashboardLive } from "../phc-checklist/js/dashboard-live.mjs";

const tick = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
function sourceHarness(ensureSession=async()=>{}) {
  const listeners=[], received=[], errors=[];
  const stop=subscribeDashboard({ensureSession,from:"2026-10-05",to:"2026-10-11",
    next:data=>received.push(data),error:error=>errors.push(error),
    listen:(name,filters,next,error)=>{
      const listener={name,filters,next,error,stopped:false};listeners.push(listener);
      return ()=>{listener.stopped=true;};
    }});
  return {listeners,received,errors,stop};
}
test("initial listener only reads the selected week and outstanding findings; no partial cache erases data",async()=>{
  const h=sourceHarness(); await tick();
  assert.deepEqual(h.listeners.map(l=>[l.name,l.filters]),[
    ["phc_inspections",[["date",">=","2026-10-05"],["date","<=","2026-10-11"]]],
    ["phc_findings",[["date",">=","2026-10-05"],["date","<=","2026-10-11"]]],
    ["phc_findings",[["status","==","Belum diambil tindakan"]]]
  ]);
  const [records,week,open]=h.listeners;
  records.next([],{fromCache:true});week.next([],{});open.next([],{});
  assert.equal(h.received.length,0);
  records.next([{id:"inspection"}],{fromCache:false,hasPendingWrites:true});
  assert.equal(h.received.length,0);
  records.next([{id:"inspection"}],{fromCache:false,hasPendingWrites:false});
  assert.equal(h.received.length,1);assert.equal(h.received[0].records[0].id,"inspection");
  h.stop();assert.ok(h.listeners.every(l=>l.stopped));
});
test("old unresolved shortages/notes remain; resolved findings disappear without duplicate IDs",async()=>{
  const h=sourceHarness();await tick();const [records,week,open]=h.listeners;
  records.next([],{});
  week.next([{id:"current",status:"Belum diambil tindakan",updatedAt:"2026-10-05"}],{});
  open.next([{id:"current",status:"Belum diambil tindakan",updatedAt:"2026-10-05"},{id:"old-shortage",date:"2026-09-01",type:"shortage"},{id:"old-note",date:"2026-09-02",type:"note"}],{});
  assert.deepEqual(h.received.at(-1).findings.map(r=>r.id).sort(),["current","old-note","old-shortage"]);
  week.next([{id:"current",status:"Telah diambil tindakan",updatedAt:"2026-10-06"}],{});
  assert.equal(h.received.at(-1).findings.find(r=>r.id==="current").status,"Telah diambil tindakan");
  open.next([],{});
  assert.deepEqual(h.received.at(-1).findings.map(r=>r.id),["current"]);
  h.stop();
});
test("two clients receive a remote inspection and restock without a refresh query",async()=>{
  const a=sourceHarness(),b=sourceHarness();await tick();
  for(const h of [a,b]) for(const l of h.listeners) l.next([],{});
  for(const h of [a,b]) h.listeners[0].next([{id:"remote-save",date:"2026-10-05",bag:"PHC 1"}],{});
  assert.deepEqual(a.received.at(-1),b.received.at(-1));
  for(const h of [a,b]) h.listeners[2].next([{id:"older-restock",date:"2026-09-01"}],{});
  for(const h of [a,b]) h.listeners[2].next([],{});
  assert.equal(b.received.at(-1).findings.length,0);
  assert.equal(a.listeners.length,3);assert.equal(b.listeners.length,3);a.stop();b.stop();
});
test("stopping before auth completes cannot leave orphan listeners",async()=>{
  let ready;const h=sourceHarness(()=>new Promise(resolve=>{ready=resolve;}));
  await tick();h.stop();ready();await tick();assert.equal(h.listeners.length,0);
});
test("one listener failure stops the whole set and ignores late snapshots",async()=>{
  const h=sourceHarness();await tick();h.listeners[1].error(new Error("permission denied"));
  assert.equal(h.errors.length,1);assert.ok(h.listeners.every(l=>l.stopped));
  h.listeners.forEach(l=>l.next([],{}));assert.equal(h.received.length,0);
});
function controllerHarness(){
  const subscriptions=[],jobs=new Map(),received=[];let id=0,online=true,pending=false,syncs=0;
  let range={from:"2026-10-05",to:"2026-10-11"};
  const live=createDashboardLive({
    subscribe:(from,to,next,error)=>{const s={from,to,next,error,stopped:false};subscriptions.push(s);return()=>{s.stopped=true;};},
    getRange:()=>range,onData:data=>received.push(data),onError:()=>{},
    hasPending:()=>pending,isOnline:()=>online,sync:async()=>{syncs++;},
    schedule:(callback,delay)=>{jobs.set(++id,{callback,delay});return id;},cancel:id=>jobs.delete(id)
  });
  async function runNext(){const [id,job]=jobs.entries().next().value;jobs.delete(id);job.callback();await tick();return job.delay;}
  return {live,subscriptions,jobs,received,runNext,setRange:value=>range=value,setOnline:value=>online=value,setPending:value=>pending=value,get syncs(){return syncs;}};
}
test("healthy idle dashboard has no read polling and repeated focus/online events retain listeners",()=>{
  const h=controllerHarness();for(let i=0;i<20;i++)h.live.resume();
  assert.equal(h.subscriptions.length,1);assert.equal(h.jobs.size,0);h.live.stop();
});
test("week rollover unsubscribes old listeners; stale callbacks cannot replace new data",()=>{
  const h=controllerHarness();h.live.resume();const first=h.subscriptions[0];
  h.setRange({from:"2026-10-12",to:"2026-10-18"});h.live.resume();
  assert.equal(first.stopped,true);assert.equal(h.subscriptions.length,2);
  first.next({old:true});h.subscriptions[1].next({new:true});assert.deepEqual(h.received,[{new:true}]);h.live.stop();
});
test("offline queue retries independently with backoff and stops once sent",async()=>{
  const h=controllerHarness();h.setPending(true);h.setOnline(false);h.live.resume();
  assert.equal(h.jobs.size,0);h.setOnline(true);h.live.resume();
  assert.equal(await h.runNext(),0);assert.equal(h.syncs,1);
  assert.equal(await h.runNext(),5000);assert.equal(h.syncs,2);
  assert.equal([...h.jobs.values()][0].delay,10000);
  h.setPending(false);await h.runNext();assert.equal(h.jobs.size,0);
  assert.equal(h.subscriptions.length,1);h.live.stop();
});
test("failed listener retries but healthy callback resets backoff; leaving cancels retries",async()=>{
  const h=controllerHarness();h.live.resume();h.subscriptions[0].error(new Error("network"));
  assert.equal(h.subscriptions[0].stopped,true);assert.equal([...h.jobs.values()][0].delay,1000);
  await h.runNext();h.subscriptions[1].next({ready:true});h.subscriptions[1].error(new Error("network"));
  assert.equal([...h.jobs.values()][0].delay,1000);h.live.stop();assert.equal(h.jobs.size,0);
  h.subscriptions[1].next({stale:true});assert.deepEqual(h.received,[{ready:true}]);
});
test("pagehide followed by pageshow creates only one replacement listener",()=>{
  const h=controllerHarness();h.live.resume();h.live.stop();h.live.resume();h.live.resume();
  assert.equal(h.subscriptions.length,2);assert.equal(h.subscriptions[0].stopped,true);h.live.stop();
});
