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

export function buildDailyComplianceSummary(rows, meta, today, recordDate) {
  const completedDays = new Set(rows.map(recordDate).filter(Boolean));
  const currentMonth = today.slice(0, 7);
  const reportDays = meta.value > currentMonth ? [] : meta.value === currentMonth ? meta.days.filter(date => date <= today) : meta.days;
  const compliantDays = reportDays.filter(date => completedDays.has(date)).length;
  return { completedDays, reportDays, compliantDays, rate:reportDays.length ? (compliantDays / reportDays.length) * 100 : 0 };
}

export function buildPhcMonthlySummary(rows, meta, today, recordDate) {
  return buildDailyComplianceSummary(rows, meta, today, recordDate);
}
