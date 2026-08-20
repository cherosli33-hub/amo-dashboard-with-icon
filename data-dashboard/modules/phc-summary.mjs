export function buildDailyVerificationStates(rows, auditRows, sourceModule, recordDate) {
  const audits = new Map();
  auditRows.filter(row => row.sourceModule === sourceModule).forEach(row => {
    const date = row.sourceDate || recordDate(row);
    if (date && !audits.has(date)) audits.set(date, row);
  });
  const grouped = new Map();
  rows.forEach(row => {
    const date = recordDate(row);
    if (!date) return;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(row);
  });
  return [...grouped.entries()].map(([date, records]) => {
    const unverified = records.filter(row => row.verified !== true);
    return { date, records, unverified, audit:audits.get(date), complete:!unverified.length };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export function buildPhcDailyStates(phcRows, auditRows, recordDate) {
  return buildDailyVerificationStates(phcRows, auditRows, "phc-daily", recordDate);
}

export function selectAllDailyVerificationKeys(items, checked) {
  return new Set(checked ? items.map(item => item.key) : []);
}

export function latestRowsBySlot(rows, slotKey, recordTime) {
  const latest = new Map();
  rows.forEach(row => {
    const key = slotKey(row);
    if (!key) return;
    const current = latest.get(key);
    if (!current || recordTime(row) >= recordTime(current)) latest.set(key, row);
  });
  return [...latest.values()];
}

export function buildDailyComplianceSummary(rows, meta, today, recordDate) {
  const recordsByDay = new Map();
  rows.forEach(row => {
    const date = recordDate(row);
    if (!date) return;
    if (!recordsByDay.has(date)) recordsByDay.set(date, []);
    recordsByDay.get(date).push(row);
  });
  const completedDays = new Set(recordsByDay.keys());
  const currentMonth = today.slice(0, 7);
  const reportDays = meta.value > currentMonth ? [] : meta.value === currentMonth ? meta.days.filter(date => date <= today) : meta.days;
  const dayStates = reportDays.map(date => {
    const records = recordsByDay.get(date) || [];
    const completed = records.length > 0;
    const verified = completed && records.every(row => row.verified === true);
    return { date, records, recordCount:records.length, completed, verified, status:!completed ? "missing" : verified ? "verified" : "pending" };
  });
  const verifiedDays = new Set(dayStates.filter(day => day.verified).map(day => day.date));
  const compliantDays = verifiedDays.size;
  const pendingVerificationDays = dayStates.filter(day => day.status === "pending").length;
  const missingDays = dayStates.filter(day => day.status === "missing").length;
  return { completedDays, verifiedDays, recordsByDay, reportDays, dayStates, compliantDays, pendingVerificationDays, missingDays, rate:reportDays.length ? (compliantDays / reportDays.length) * 100 : 0 };
}

export function buildPhcMonthlySummary(rows, meta, today, recordDate) {
  return buildDailyComplianceSummary(rows, meta, today, recordDate);
}
