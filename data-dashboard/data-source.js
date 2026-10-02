import { collection, doc, documentId, getDocsFromServer, limit, onSnapshot, orderBy, query, startAfter, Timestamp, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "../shared/firebase/core.js";
import { dateWindow, monthWindow, mergeRows, readPages, withTimeout } from "./loading.mjs";

// Date-scoped live streams serve the first screen. A separate paged compatibility
// pass catches legacy outstanding records with missing verified/status fields.
// Firestore != queries exclude absent fields, so never use them as the only queue.
export function createDashboardDataSource({ streams, pendingModules, isPending, onRows, onError, onPendingState }) {
  const live = new Map(), pending = new Map(), watches = new Map(), versions = new Map();
  const stops = [];
  let stopped = false, scanning = null, dayKey = "", rollover;
  const liveStops = [];
  const emit = module => {
    if (stopped) return;
    onRows(module, mergeRows(...(live.get(module.id)?.values() || []), [...(pending.get(module.id)?.values() || [])]), live.get(module.id)?.size === rangesFor(module, dateWindow()).length);
  };
  const fieldsFor = module => module.id === "asthma" ? ["date", "timestamp"] : module.id === "girn" ? ["date", "submittedAt"] : ["date"];
  const constraintsFor = (field, range, asTimestamp = false) => {
    const a = field === "date" ? range.start : new Date(`${range.start}T00:00:00+08:00`);
    const b = field === "date" ? range.end : new Date(`${range.end}T00:00:00+08:00`);
    const value = date => asTimestamp ? Timestamp.fromDate(date) : date instanceof Date ? date.toISOString() : date;
    return [where(field, ">=", value(a)), where(field, "<", value(b))];
  };
  const rangesFor = (module, range) => fieldsFor(module).flatMap(field => field === "date" ? [{ field, constraints:constraintsFor(field, range) }] : [{ field, constraints:constraintsFor(field, range) }, { field, constraints:constraintsFor(field, range, true) }]);
  const watchPending = (module, row) => {
    const key = `${module.id}:${row.id}`;
    if (watches.has(key)) return;
    const stop = onSnapshot(doc(db, module.collection, row.id), { includeMetadataChanges:true }, snapshot => {
      if (stopped || snapshot.metadata.fromCache) return;
      versions.set(key, (versions.get(key) || 0) + 1);
      const current = snapshot.exists() ? { id:snapshot.id, ...snapshot.data() } : null;
      if (current && isPending(module, current)) pending.get(module.id).set(row.id, current);
      else { pending.get(module.id).delete(row.id); watches.get(key)?.(); watches.delete(key); }
      emit(module);
    }, error => { if (!stopped) onError(module, error); });
    watches.set(key, stop);
  };
  const updatePending = (module, row) => {
    if (!pending.has(module.id)) pending.set(module.id, new Map());
    if (isPending(module, row)) { pending.get(module.id).set(row.id, row); watchPending(module, row); }
    else pending.get(module.id).delete(row.id);
  };
  const listenToday = () => {
    liveStops.splice(0).forEach(stop => stop());
    const range = dateWindow(); dayKey = range.start;
    streams.forEach(module => {
      live.set(module.id, new Map());
      rangesFor(module, range).forEach(({ constraints }, index) => {
        const stop = onSnapshot(query(collection(db, module.collection), ...constraints), { includeMetadataChanges:true }, snapshot => {
          if (stopped || snapshot.metadata.fromCache) return;
          const rows = snapshot.docs.map(item => ({ id:item.id, ...item.data() })).filter(row => !module.filter || module.filter(row));
          live.get(module.id).set(index, rows);
          if (pendingModules.includes(module)) rows.forEach(row => updatePending(module, row));
          emit(module);
        }, error => { if (!stopped) onError(module, error); });
        liveStops.push(stop);
      });
    });
  };
  async function refreshPending() {
    if (stopped) return;
    if (scanning) return scanning;
    onPendingState(false);
    scanning = (async () => {
      const results = await Promise.allSettled(pendingModules.map(async module => {
        const initialVersions = new Map(versions);
        await readPages(async (cursor, count) => {
          if (stopped) throw new Error("closed");
          return withTimeout(getDocsFromServer(query(collection(db, module.collection), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(count))), 20000);
        }, docs => {
          if (stopped) return;
          for (const item of docs) {
            const key = `${module.id}:${item.id}`;
            if ((versions.get(key) || 0) !== (initialVersions.get(key) || 0)) continue;
            const row = { id:item.id, ...item.data() };
            if (!module.filter || module.filter(row)) updatePending(module, row);
          }
          emit(module);
        });
      }));
      if (!stopped) {
        const failed = results.find(result => result.status === "rejected");
        onPendingState(!failed, failed?.reason);
      }
    })().finally(() => { scanning = null; });
    return scanning;
  }
  return {
    start() {
      listenToday();
      // All current writers stamp updatedAt. This catches newly added or edited
      // backdated records without subscribing to entire historical collections.
      const since = Timestamp.fromDate(new Date(Date.now() - 60000));
      pendingModules.forEach(module => {
        stops.push(onSnapshot(query(collection(db, module.collection), where("updatedAt", ">=", since)), { includeMetadataChanges:true }, snapshot => {
          if (stopped || snapshot.metadata.fromCache) return;
          snapshot.docChanges().forEach(change => {
            if (change.type === "removed") return;
            const row = { id:change.doc.id, ...change.doc.data() };
            if (!module.filter || module.filter(row)) updatePending(module, row);
          });
          emit(module);
        }, error => { if (!stopped) onError(module, error); }));
      });
      // Queues load in the background and do not hold the access screen closed.
      void refreshPending();
      rollover = setInterval(() => { if (dateWindow().start !== dayKey) listenToday(); }, 60000);
    },
    refreshPending,
    async month(module, value) {
      const rows = [];
      for (const { field, constraints } of rangesFor(module, monthWindow(value))) {
        await readPages(cursor => withTimeout(getDocsFromServer(query(collection(db, module.collection), ...constraints, orderBy(field), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(250))), 20000), docs => {
          rows.push(...docs.map(item => ({ id:item.id, ...item.data() })).filter(row => !module.filter || module.filter(row)));
        });
      }
      return mergeRows(rows);
    },
    stop() { stopped = true; clearInterval(rollover); liveStops.forEach(stop => stop()); stops.forEach(stop => stop()); watches.forEach(stop => stop()); }
  };
}
