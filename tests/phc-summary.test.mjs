import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyComplianceSummary, buildDailyVerificationStates, buildPhcDailyStates, buildPhcMonthlySummary, selectAllDailyVerificationKeys } from "../data-dashboard/modules/phc-summary.mjs";

const recordDate = row => row.date || "";

test("tarikh lama dengan rekod belum disahkan kekal dalam tindakan penyelia", () => {
  const rows = [
    { id:"phc1", date:"2026-08-19", verified:false },
    { id:"phc2", date:"2026-08-19", verified:false },
    { id:"today", date:"2026-08-20", verified:true }
  ];
  const states = buildPhcDailyStates(rows, [], recordDate);
  assert.deepEqual(states.filter(day => !day.complete).map(day => day.date), ["2026-08-19"]);
  assert.equal(states.find(day => day.date === "2026-08-19").unverified.length, 2);
});

test("rekod lewat masih tertunggak walaupun tarikh sama pernah diaudit", () => {
  const rows = [
    { id:"old", date:"2026-08-19", verified:true },
    { id:"late", date:"2026-08-19", verified:false }
  ];
  const audits = [{ sourceModule:"phc-daily", sourceDate:"2026-08-19", actorName:"Penyelia" }];
  const [state] = buildPhcDailyStates(rows, audits, recordDate);
  assert.equal(state.complete, false);
  assert.deepEqual(state.unverified.map(row => row.id), ["late"]);
});

test("rekod GIRN dikumpulkan mengikut tarikh untuk pengesahan penyelia", () => {
  const rows = [
    { id:"morning", date:"2026-08-20", shift:"morning" },
    { id:"evening", date:"2026-08-20", shift:"evening" },
    { id:"yesterday", date:"2026-08-19", shift:"night", verified:true }
  ];
  const states = buildDailyVerificationStates(rows, [], "girn-daily", recordDate);
  assert.deepEqual(states.filter(day => !day.complete).map(day => day.date), ["2026-08-20"]);
  assert.equal(states[0].unverified.length, 2);
});

test("audit GIRN lama tidak menutup rekod GIRN lewat", () => {
  const rows = [
    { id:"old", date:"2026-08-20", verified:true },
    { id:"late", date:"2026-08-20", verified:false }
  ];
  const audits = [{ sourceModule:"girn-daily", sourceDate:"2026-08-20" }];
  const [state] = buildDailyVerificationStates(rows, audits, "girn-daily", recordDate);
  assert.equal(state.complete, false);
  assert.deepEqual(state.unverified.map(row => row.id), ["late"]);
});

test("pilih semua merangkumi pengesahan PHC dan GIRN", () => {
  const items = [{ key:"phc:2026-08-19" }, { key:"girn:2026-08-19" }, { key:"girn:2026-08-20" }];
  assert.deepEqual([...selectAllDailyVerificationKeys(items, true)], items.map(item => item.key));
  assert.equal(selectAllDailyVerificationKeys(items, false).size, 0);
});

test("satu checklist yang disahkan pada mana-mana syif menjadikan hari itu patuh", () => {
  const days = Array.from({ length:31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
  const rows = [
    { date:"2026-08-19", bag:"PHC 1", shift:"night", verified:true },
    { date:"2026-08-20", bag:"PHC 2", shift:"morning", verified:true }
  ];
  const summary = buildPhcMonthlySummary(rows, { value:"2026-08", days }, "2026-08-20", recordDate);
  assert.equal(summary.reportDays.length, 20);
  assert.equal(summary.compliantDays, 2);
  assert.equal(summary.completedDays.has("2026-08-20"), true);
});

test("tarikh akan datang tidak dimasukkan dalam pematuhan bulan semasa", () => {
  const days = Array.from({ length:31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
  const summary = buildPhcMonthlySummary([], { value:"2026-08", days }, "2026-08-20", recordDate);
  assert.equal(summary.reportDays.at(-1), "2026-08-20");
  assert.equal(summary.reportDays.includes("2026-08-21"), false);
});

test("laporan GIRN mengira satu checklist pada mana-mana syif sebagai satu hari patuh", () => {
  const days = Array.from({ length:31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
  const rows = [
    { date:"2026-08-18", shift:"night", verified:true },
    { date:"2026-08-20", shift:"morning", verified:true },
    { date:"2026-08-20", shift:"evening", verified:true }
  ];
  const summary = buildDailyComplianceSummary(rows, { value:"2026-08", days }, "2026-08-20", recordDate);
  assert.equal(summary.reportDays.length, 20);
  assert.equal(summary.compliantDays, 2);
  assert.equal(summary.completedDays.size, 2);
});

test("laporan membezakan hari disahkan, belum disahkan dan tidak dibuat", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const rows = [
    { date:"2026-08-01", verified:true },
    { date:"2026-08-01", verified:true },
    { date:"2026-08-02", verified:true },
    { date:"2026-08-02", verified:false }
  ];
  const summary = buildDailyComplianceSummary(rows, { value:"2026-08", days }, "2026-08-03", recordDate);
  assert.equal(summary.compliantDays, 1);
  assert.equal(summary.pendingVerificationDays, 1);
  assert.equal(summary.missingDays, 1);
  assert.ok(Math.abs(summary.rate - (100 / 3)) < Number.EPSILON * 100);
  assert.deepEqual(summary.dayStates.map(day => [day.date, day.status, day.recordCount]), [
    ["2026-08-01", "verified", 2],
    ["2026-08-02", "pending", 2],
    ["2026-08-03", "missing", 0]
  ]);
});
