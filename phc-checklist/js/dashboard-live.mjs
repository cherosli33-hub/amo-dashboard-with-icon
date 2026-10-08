// No healthy-listener polling: timers only retry failed listeners or queued writes.
export function createDashboardLive({ subscribe, getRange, onData, onError, sync, hasPending,
  isOnline = () => true, schedule = setTimeout, cancel = clearTimeout }) {
  let active = false, stop = null, key = "", generation = 0;
  let listenerRetry = null, syncRetry = null, syncing = null;
  let listenerDelay = 1000, syncDelay = 5000;
  function clearListenerRetry() { if (listenerRetry !== null) cancel(listenerRetry); listenerRetry = null; }
  function clearSyncRetry() { if (syncRetry !== null) cancel(syncRetry); syncRetry = null; }
  function requestSync(delay = 0) {
    if (!active || !hasPending() || syncRetry !== null || syncing || !isOnline()) return;
    syncRetry = schedule(() => { syncRetry = null; void flush(); }, delay);
  }
  async function flush() {
    if (!active || syncing || !isOnline() || !hasPending()) return;
    syncing = Promise.resolve().then(sync);
    try { await syncing; } catch { /* The durable app queue retains unsuccessful writes. */ }
    finally {
      syncing = null;
      if (active && hasPending()) { requestSync(syncDelay); syncDelay = Math.min(syncDelay * 2, 60000); }
      else syncDelay = 5000;
    }
  }
  function connect() {
    if (!active) return;
    const range = getRange(), nextKey = `${range.from}|${range.to}`;
    if (stop && key === nextKey) return;
    clearListenerRetry();
    stop?.(); stop = null; key = nextKey;
    const version = ++generation;
    try {
      const candidate = subscribe(range.from, range.to, data => {
        if (!active || version !== generation) return;
        listenerDelay = 1000;
        onData(data, range);
      }, cause => {
        if (!active || version !== generation) return;
        ++generation; stop?.(); stop = null;
        onError(cause);
        if (isOnline()) {
          listenerRetry = schedule(() => { listenerRetry = null; connect(); }, listenerDelay);
          listenerDelay = Math.min(listenerDelay * 2, 60000);
        }
      });
      if (!active || version !== generation) candidate();
      else stop = candidate;
    } catch (cause) {
      onError(cause);
      listenerRetry = schedule(() => { listenerRetry = null; connect(); }, listenerDelay);
      listenerDelay = Math.min(listenerDelay * 2, 60000);
    }
  }
  return {
    resume() {
      active = true;
      // Focus/pageshow/online can fire together: retain the same live subscription.
      if (listenerRetry === null || key !== `${getRange().from}|${getRange().to}`) connect();
      requestSync();
    },
    requestSync,
    stop() {
      active = false; ++generation; stop?.(); stop = null; key = "";
      clearListenerRetry(); clearSyncRetry();
    }
  };
}
