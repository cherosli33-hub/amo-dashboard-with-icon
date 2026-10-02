export function withTimeout(promise, milliseconds, message = "Sambungan mengambil masa terlalu lama.") {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
}
export function dateWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Kuala_Lumpur", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23" }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const shift = (key, days) => new Date(new Date(`${key}T00:00:00+08:00`).getTime() + days * 86400000).toLocaleDateString("en-CA", { timeZone:"Asia/Kuala_Lumpur", year:"numeric", month:"2-digit", day:"2-digit" });
  return { start:Number(parts.hour) < 7 ? shift(today, -1) : today, end:shift(today, 2) };
}
export function monthWindow(value) {
  const [year, month] = value.split("-").map(Number);
  if (!/^\d{4}-\d{2}$/.test(value) || month < 1 || month > 12) throw new Error("Bulan tidak sah.");
  const next = new Date(Date.UTC(year, month, 1));
  // One extra calendar day includes the night shift ending at 07:00 next month.
  const end = new Date(next.getTime() + 86400000).toISOString().slice(0, 10);
  return { start:`${value}-01`, end };
}
export function mergeRows(...sources) {
  const rows = new Map();
  for (const source of sources) for (const row of source) rows.set(row.id, row);
  return [...rows.values()];
}
export async function readPages(fetchPage, onPage = () => {}, pageSize = 250) {
  let cursor = null;
  while (true) {
    const page = await fetchPage(cursor, pageSize);
    await onPage(page.docs);
    if (page.docs.length < pageSize) return;
    const next = page.docs.at(-1);
    if (cursor && next.id === cursor.id) throw new Error("Halaman rekod tidak bergerak.");
    cursor = next;
  }
}
