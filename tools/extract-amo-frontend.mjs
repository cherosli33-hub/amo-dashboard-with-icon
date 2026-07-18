import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function extractProductionHtml(source) {
  const match = source.match(/const DASHBOARD_HTML = ("(?:\\.|[^"\\])*");\s*\r?\n/);
  if (!match) throw new Error("DASHBOARD_HTML was not found in the cloned Apps Script source.");
  return JSON.parse(match[1]);
}

export function migrateHtml(productionHtml) {
  let html = productionHtml;
  const replaceRequired = (search, replacement, label) => {
    if (search instanceof RegExp ? !search.test(html) : !html.includes(search)) {
      throw new Error(`Expected ${label} was not found.`);
    }
    html = html.replace(search, replacement);
  };

  replaceRequired(
    'const BASE_URL = "%%BASE_URL%%";',
    'const BASE_URL = window.AMO_CONFIG.apiUrl;',
    "Apps Script base URL placeholder"
  );
  replaceRequired(
    "</head>",
    '<script src="./amo-config.js"></script>\n</head>',
    "document head"
  );
  replaceRequired(
    /<link href="(https:\/\/fonts\.googleapis\.com\/css2\?family=[^"]+)" rel="stylesheet">/,
    '<link href="$1" rel="stylesheet" media="print" onload="this.media=\'all\'">\n<noscript><link href="$1" rel="stylesheet"></noscript>',
    "Google Fonts stylesheet"
  );

  // First paint must never wait for Google Sheet.
  replaceRequired(
    '<div id="loading-screen" class="loading-screen">',
    '<div id="loading-screen" class="loading-screen hidden">',
    "loading screen"
  );
  replaceRequired(
    '<div id="dashboard-view" class="wrap hidden"></div>',
    '<div id="dashboard-view" class="wrap"></div>',
    "dashboard container"
  );
  replaceRequired(
    '<button id="fab" class="fab hidden" aria-label="Tambah kes baru">',
    '<button id="fab" class="fab" aria-label="Tambah kes baru">',
    "new-case button"
  );

  const syncMessage = '  showToast("Kes direkod. Sync ke Sheet...");';
  replaceRequired(
    syncMessage,
    `${syncMessage}\n  writeCasesCache(state.cases);\n\n  if(!window.AMO_CONFIG.writeEnabled){\n    showToast("Mod ujian: tiada data dihantar ke Google Sheet");\n    return;\n  }`,
    "save flow"
  );

  const cacheAndRefreshLayer = `
const AMO_CASE_CACHE_KEY = "amo-procedure-cases-v1";

function readCasesCache(){
  try{
    const cached = JSON.parse(localStorage.getItem(AMO_CASE_CACHE_KEY) || "[]");
    return Array.isArray(cached) ? cached : [];
  }catch(_){ return []; }
}

function writeCasesCache(cases){
  try{ localStorage.setItem(AMO_CASE_CACHE_KEY, JSON.stringify(cases || [])); }
  catch(_){ /* Cache is optional; Sheet remains the source of truth. */ }
}

function casesFromSheetRows(rows){
  const headers = (rows[0] || []).map(h => String(h || "").trim());
  const findIndex = (name, fallback) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? idx : fallback;
  };
  const hasZoneColumns = headers.includes("Zone") || headers.includes("IDPesakit") || headers.includes("ID Pesakit") || headers.includes("RegistrationNumber");
  const col = {
    ts: findIndex("Timestamp", 0),
    date: findIndex("Date", 1),
    time: findIndex("Time", 2),
    shift: findIndex("Shift", 3),
    zone: findIndex("Zone", hasZoneColumns ? 4 : -1),
    reg: findIndex("IDPesakit", findIndex("ID Pesakit", findIndex("RegistrationNumber", hasZoneColumns ? 5 : -1))),
    procedure: findIndex("Procedure", hasZoneColumns ? 6 : 4),
    minutes: findIndex("DurationMinutes", hasZoneColumns ? 7 : 5),
  };
  const grouped = {};
  const trendDateKeys = visibleTrendDateKeys();
  rows.slice(1).forEach((row, idx) => {
    const ts = row[col.ts];
    const dateKey = normalizeDateKey(row[col.date]);
    if(!trendDateKeys.has(dateKey)) return;
    const time = row[col.time];
    const shift = row[col.shift];
    const zone = col.zone >= 0 ? String(row[col.zone] || "").trim() : "";
    const registrationNumber = col.reg >= 0 ? String(row[col.reg] || "").trim() : "";
    const key = \`\${ts}|\${dateKey}|\${time}|\${shift}|\${zone}|\${registrationNumber}\`;
    if(!grouped[key]) grouped[key] = { id: \`remote_\${idx}_\${ts}\`, date: dateKey, time, shift, zone, registrationNumber, procedures: [] };
    const durMin = Number(row[col.minutes]);
    const durMatch = DURATIONS.find(d => d.minutes === durMin);
    grouped[key].procedures.push({ name: normalizeProcedureNameV2(row[col.procedure]), minutes: durMin, durationLabel: durMatch ? durMatch.label : \`\${durMin} min\` });
  });
  return Object.values(grouped);
}
`;

  replaceRequired(
    'state.registrationNumber = ""; // ID Pesakit',
    `state.registrationNumber = ""; // ID Pesakit\n${cacheAndRefreshLayer}`,
    "enhanced patient state"
  );

  const progressiveLoad = `loadCases = async function(){
  state.dashboardDate = todayKey();
  try{
    const rows = await fetchRowsWithRetry();
    state.cases = casesFromSheetRows(rows);
    writeCasesCache(state.cases);
    state.syncError = false;
  }catch(e){
    console.error("Background Sheet refresh failed:", e);
    state.syncError = true;
  }
  document.getElementById("loading-screen").classList.add("hidden");
  document.getElementById("fab").classList.remove("hidden");
  renderView();
};

renderDashboard = function(){`;

  replaceRequired(
    /loadCases = async function\(\)\{[\s\S]*?\n\};\r?\n\r?\nrenderDashboard = function\(\)\{/,
    progressiveLoad,
    "enhanced Sheet loader"
  );

  replaceRequired(
    /\/\/ ====================== INIT ======================\r?\nloadCases\(\);/,
    `// ====================== INIT ======================\nstate.cases = readCasesCache();\nstate.dashboardDate = todayKey();\ndocument.getElementById("loading-screen").classList.add("hidden");\ndocument.getElementById("dashboard-view").classList.remove("hidden");\ndocument.getElementById("fab").classList.remove("hidden");\nrenderView();\nwindow.setTimeout(() => loadCases(), 0);`,
    "initial load"
  );

  return html;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const sourcePath = process.argv[2];
  const outputPath = process.argv[3];
  if (!sourcePath || !outputPath) {
    throw new Error("Usage: node tools/extract-amo-frontend.mjs <Code.js> <amo.html>");
  }
  const source = fs.readFileSync(sourcePath, "utf8");
  const html = migrateHtml(extractProductionHtml(source));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf8");
  console.log(`Extracted production frontend to ${outputPath}`);
}
