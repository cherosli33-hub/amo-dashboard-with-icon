// Separate date and status queries need only existing single-field indexes.
// Keep outstanding findings from older weeks without loading resolved history.
export function subscribeDashboard({ ensureSession, listen, from, to, next, error }) {
  let stopped = false;
  const stops = [];
  const results = new Map();
  function fail(cause) {
    if (stopped) return;
    stopped = true;
    stops.forEach(stop => stop());
    error?.(cause);
  }
  Promise.resolve().then(ensureSession).then(() => {
    if (stopped) return;
    for (const [key, collection, filters] of [
      ["records", "phc_inspections", [["date", ">=", from], ["date", "<=", to]]],
      ["weekFindings", "phc_findings", [["date", ">=", from], ["date", "<=", to]]],
      ["openFindings", "phc_findings", [["status", "==", "Belum diambil tindakan"]]]
    ]) {
      if (stopped) break;
      const stop = listen(collection, filters, (rows, metadata = {}) => {
        if (stopped) return;
        results.set(key, { rows, metadata });
        // A partial/offline snapshot must never erase confirmed local records.
        if (results.size !== 3 || [...results.values()].some(result => result.metadata.fromCache || result.metadata.hasPendingWrites)) return;
        const findings = new Map();
        for (const row of results.get("openFindings").rows) findings.set(row.id, row);
        // The week query also includes resolved findings. Prefer its newer copy
        // if the two query snapshots arrive on different ticks.
        for (const row of results.get("weekFindings").rows) {
          const open = findings.get(row.id);
          if (!open || String(row.updatedAt || "") >= String(open.updatedAt || "")) findings.set(row.id, row);
        }
        next({ records:results.get("records").rows, findings:[...findings.values()] });
      }, fail);
      if (stopped) stop();
      else stops.push(stop);
    }
  }).catch(fail);
  return () => { stopped = true; stops.forEach(stop => stop()); };
}
