import test from "node:test";
import assert from "node:assert/strict";
import { buildPhcDailyStates, buildPhcMonthlySummary } from "../data-dashboard/modules/phc-summary.mjs";

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

test("satu checklist pada mana-mana syif menjadikan hari itu patuh", () => {
  const days = Array.from({ length:31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
  const rows = [
    { date:"2026-08-19", bag:"PHC 1", shift:"night" },
    { date:"2026-08-20", bag:"PHC 2", shift:"morning" }
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
