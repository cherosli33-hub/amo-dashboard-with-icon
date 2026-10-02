import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dateWindow, monthWindow, mergeRows, readPages, withTimeout } from "../data-dashboard/loading.mjs";
import { buildDailyVerificationStates } from "../data-dashboard/modules/phc-summary.mjs";

const body = (await readFile(new URL("../data-dashboard/data-source.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "").replace("export function", "function");
function harness(records = []) {
  const listeners = [], reads = [], states = [], emitted = new Map();
  let fail = false;
  const sdk = {
    db:{}, collection:(_, name) => ({ name }), doc:(_, name, id) => ({ name, id }), documentId:() => "__name__",
    limit:n => ({ type:"limit", n }), orderBy:field => ({ type:"order", field }), startAfter:item => ({ type:"cursor", item }),
    where:(field, op, value) => ({ type:"where", field, op, value }), query:(ref, ...constraints) => ({ ...ref, constraints }),
    Timestamp:{ fromDate:date => ({ timestamp:date.toISOString() }) },
    onSnapshot:(ref, options, callback) => { const item = { ref, options, callback, stopped:false }; listeners.push(item); return () => { item.stopped = true; }; },
    getDocsFromServer:async ref => {
      reads.push(ref); if (fail) throw new Error("network unavailable");
      let found = records.filter(row => row.collection === ref.name);
      for (const c of ref.constraints.filter(c => c.type === "where")) found = found.filter(row => {
        const a = row[c.field], b = c.value;
        if (a === undefined || typeof a !== typeof b) return false;
        return c.op === ">=" ? a >= b : a < b;
      });
      const orders = ref.constraints.filter(c => c.type === "order");
      found.sort((a, b) => { for (const c of orders) { const av = c.field === "__name__" ? a.id : a[c.field], bv = c.field === "__name__" ? b.id : b[c.field]; if (av !== bv) return av < bv ? -1 : 1; } return 0; });
      const cursor = ref.constraints.find(c => c.type === "cursor");
      if (cursor) found = found.slice(found.findIndex(row => row.id === cursor.item.id) + 1);
      return { docs:found.slice(0, ref.constraints.find(c => c.type === "limit")?.n || Infinity).map(row => ({ id:row.id, data:() => row })) };
    }
  };
  const deps = { ...sdk, dateWindow, monthWindow, mergeRows, readPages, withTimeout };
  const factory = new Function(...Object.keys(deps), `${body}\nreturn createDashboardDataSource;`)(...Object.values(deps));
  const phc = { id:"phc", collection:"phc" }, girn = { id:"girn", collection:"girn" };
  const source = factory({ streams:[phc, girn], pendingModules:[phc, girn], isPending:(_, row) => row.verified !== true,
    onRows:(module, rows, ready) => emitted.set(module.id, { rows, ready }), onError:() => {}, onPendingState:(complete, error) => states.push({ complete, error }) });
  return { source, phc, girn, listeners, reads, states, emitted, setFail:value => { fail = value; } };
}

test("operational window includes the previous date until 07:00 Malaysia", () => {
  assert.equal(dateWindow(new Date("2026-10-02T06:59:59+08:00")).start, "2026-10-01");
  assert.equal(dateWindow(new Date("2026-10-02T07:00:00+08:00")).start, "2026-10-02");
  assert.deepEqual(monthWindow("2026-12"), { start:"2026-12-01", end:"2027-01-02" });
});
test("timeout rejects hanging access checks", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /terlalu lama/);
});
test("legacy outstanding queue includes absent verified and rows past old 5000 cutoff", async () => {
  const records = Array.from({ length:5063 }, (_, i) => ({ id:String(i).padStart(5,"0"), collection:"phc", date:"2026-08-01", ...(i % 2 ? { verified:true } : {}) }));
  const h = harness(records);
  h.source.start(); await h.source.refreshPending();
  const rows = h.emitted.get("phc").rows;
  assert.equal(rows.length, 2532);
  assert.ok(rows.some(row => row.id === "05062"));
  assert.equal(h.reads.filter(ref => ref.name === "phc").length, 21);
  assert.equal(h.states.at(-1).complete, true);
  assert.equal(h.emitted.get("phc").ready, false, "background history cannot mark today's data ready");
  h.source.stop(); assert.ok(h.listeners.every(item => item.stopped));
});
test("verified legacy document leaves the outstanding list immediately", async () => {
  const h = harness([{ id:"legacy", collection:"phc", date:"2026-08-01" }]);
  h.source.start(); await h.source.refreshPending();
  const listener = h.listeners.find(item => item.ref.id === "legacy");
  listener.callback({ id:"legacy", metadata:{ fromCache:false }, exists:() => true, data:() => ({ date:"2026-08-01", verified:true }) });
  assert.deepEqual(h.emitted.get("phc").rows, []);
  assert.ok(listener.stopped); h.source.stop();
});
test("backdated new checklist is discovered through updatedAt even after initial scan", async () => {
  const h = harness(); h.source.start(); await h.source.refreshPending();
  const changes = h.listeners.find(item => item.ref.name === "phc" && item.ref.constraints?.some(c => c.field === "updatedAt"));
  changes.callback({ metadata:{ fromCache:false }, docChanges:() => [{ type:"added", doc:{ id:"late", data:() => ({ date:"2026-07-04" }) } }] });
  assert.ok(h.emitted.get("phc").rows.some(row => row.id === "late")); h.source.stop();
});
test("failed legacy scan cannot claim there are no pending records", async () => {
  const h = harness(); h.setFail(true); h.source.start(); await h.source.refreshPending();
  assert.equal(h.states.at(-1).complete, false); assert.ok(h.states.at(-1).error); h.source.stop();
});
test("monthly query paginates all rows in chosen month and includes next-day night shift", async () => {
  const records = Array.from({ length:501 }, (_, i) => ({ id:`row-${String(i).padStart(4,"0")}`, collection:"phc", date:"2026-09-15", verified:true }));
  records.push({ id:"night", collection:"phc", date:"2026-10-01", shift:"night", time:"03:00" }, { id:"excluded", collection:"phc", date:"2026-08-01" });
  const h = harness(records); const rows = await h.source.month(h.phc, "2026-09");
  assert.equal(rows.length, 502); assert.ok(rows.some(row => row.id === "night"));
  assert.ok(!rows.some(row => row.id === "excluded"));
  assert.equal(h.reads.length, 3);
  assert.ok(h.reads.every(ref => ref.constraints.find(c => c.type === "order").field === "date")); h.source.stop();
});
test("queue grouping keeps both missing and false verified rows; audit cannot close new rows", () => {
  const rows = [{ id:"missing", date:"2026-08-01" }, { id:"false", date:"2026-08-01", verified:false }, { id:"done", date:"2026-08-01", verified:true }];
  const days = buildDailyVerificationStates(rows, [{ sourceModule:"phc-daily", sourceDate:"2026-08-01" }], "phc-daily", row => row.date);
  assert.equal(days[0].unverified.length, 2); assert.equal(days[0].complete, false);
});
