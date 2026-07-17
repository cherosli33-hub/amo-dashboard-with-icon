const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Range {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }
  setValues(values) {
    values.forEach((row, y) => row.forEach((value, x) => this.sheet.setCell(this.row + y, this.column + x, value)));
    return this;
  }
  getDisplayValues() {
    return Array.from({ length: this.rowCount }, (_, y) =>
      Array.from({ length: this.columnCount }, (_, x) => String(this.sheet.getCell(this.row + y, this.column + x) ?? ""))
    );
  }
  getValues() {
    return Array.from({ length: this.rowCount }, (_, y) =>
      Array.from({ length: this.columnCount }, (_, x) => this.sheet.getCell(this.row + y, this.column + x))
    );
  }
  setValue(value) { this.sheet.setCell(this.row, this.column, value); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setNumberFormat() { return this; }
  merge() { return this; }
  createFilter() { this.sheet.filter = true; return this; }
  setFormula(value) { return this.setValue(value); }
  setDataValidation() { return this; }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  getName() { return this.name; }
  getLastRow() {
    let last = 0;
    this.rows.forEach((row, index) => { if (row.some(value => value !== "" && value !== undefined)) last = index + 1; });
    return last;
  }
  getRange(row, column, rowCount, columnCount) {
    if (typeof row === "string") return new Range(this, 1, 1, 1, 1);
    return new Range(this, row, column, rowCount, columnCount);
  }
  getCell(row, column) { return this.rows[row - 1]?.[column - 1] ?? ""; }
  setCell(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }
  appendRow(row) { this.rows.push([...row]); }
  deleteColumn(column) { this.rows.forEach(row => row.splice(column - 1, 1)); }
  clear() { this.rows = []; this.filter = false; }
  getFilter() { return this.filter ? {} : null; }
  getMaxRows() { return Math.max(this.rows.length, 1000); }
  setFrozenRows() {}
  autoResizeColumns() {}
}

class Spreadsheet {
  constructor() { this.sheets = new Map(); }
  getId() { return "TEST_SHEET"; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new Sheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
  getSheets() { return [...this.sheets.values()]; }
  deleteSheet(sheet) { this.sheets.delete(sheet.getName()); }
}

const spreadsheet = new Spreadsheet();
const context = {
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => spreadsheet,
    openById: () => spreadsheet,
    flush() {},
    newDataValidation: () => ({ requireNumberBetween() { return this; }, build() { return {}; } })
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { formatDate: (date, _zone, pattern) => pattern === "yyyyMMdd" ? date.toISOString().slice(0, 10).replaceAll("-", "") : date.toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => "Asia/Kuala_Lumpur" },
  ContentService: {
    MimeType: { JSON: "json", JAVASCRIPT: "javascript" },
    createTextOutput: text => ({ text, setMimeType() { return this; } })
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: "ALLOWALL" },
    createHtmlOutput: html => ({ html, setXFrameOptionsMode() { return this; } })
  }
};

const source = fs.readFileSync(path.join(__dirname, "Code.gs"), "utf8") +
  "\n;globalThis.__api={setupAsthmaSheets,saveAsthmaAssessment_,listAsthmaAssessments_,migrateSplitBpColumns_,dateKey_,doGet,doPost};";
vm.runInNewContext(source, context);
const api = context.__api;

api.setupAsthmaSheets();
assert.deepEqual([...spreadsheet.sheets.keys()], ["Asthma_Assessment", "Asthma_Monthly_View", "Asthma_Yearly_View"]);

const base = {
  timestamp: "2026-07-16T02:30:00.000Z",
  date: "2026-07-16",
  time: "10:30",
  patientType: "adult",
  patientName: "Pesakit Ujian",
  patientId: "RN-001",
  age: 30,
  sex: "male",
  height: 175,
  bp: "120/80",
  hr: 90,
  rr: 20,
  temperature: 37,
  spo2: 98,
  pefrIdeal: 628,
  pefrBefore: 300,
  percentageBefore: 47.8,
  categoryBefore: "Severe",
  pefrAfter: 520,
  percentageAfter: 82.8,
  categoryAfter: "Mild",
  uptriage: "None",
  pefrNotDone: false,
  pppName: "PPP Rosli"
};

api.saveAsthmaAssessment_(base);
api.saveAsthmaAssessment_({
  ...base,
  patientType: "paediatric",
  patientId: "RN-002",
  sex: "female",
  pefrNotDone: true,
  notDoneReason: "Unable",
  notDoneOther: "patient factor / poor technique",
  pppName: "PPP Aminah"
});

const assessment = spreadsheet.getSheetByName("Asthma_Assessment");
assert.equal(assessment.rows[0].length, 27);
assert.equal(assessment.rows[1].length, 27);
assert.match(assessment.rows[1][0], /^AST-\d{8}-001$/);
assert.match(assessment.rows[2][0], /^AST-\d{8}-002$/);
assert.equal(assessment.rows[1][10], "120/80");
assert.equal(assessment.rows[1][26], "PPP Rosli");
assert.equal(assessment.rows[2][26], "PPP Aminah");
assert.equal(assessment.rows[2][4], "Pediatrik");
assert.equal(assessment.rows[2][16], "");
assert.equal(assessment.rows[2][23], true);
assert.equal(assessment.rows[2][24], "Unable");

assessment.rows[1][2] = new Date("2026-07-16T07:00:00.000Z");
const listed = api.listAsthmaAssessments_();
assert.equal(listed[0].date, "2026-07-16");
assert.equal(listed[0].bpSys, 120);
assert.equal(listed[0].bpDia, 80);
assert.equal(api.dateKey_("Thu Jul 16 2026 15:00:00 GMT+0800", base.timestamp), "2026-07-16");

const iframeGet = api.doGet({ parameter: { action: "listAsthmaAssessments", transport: "iframe", requestId: "request-123" } });
assert.match(iframeGet.html, /window\.top\.postMessage/);
assert.match(iframeGet.html, /amo-asthma-sheet/);
assert.match(iframeGet.html, /request-123/);

const iframePost = api.doPost({
  parameter: {
    transport: "iframe",
    requestId: "request-456",
    payload: JSON.stringify({ action: "saveAsthmaAssessment", record: { ...base, id: "browser-record-1", patientId: "RN-003" } })
  }
});
assert.match(iframePost.html, /browser-record-1/);

const legacy = new Sheet("Legacy_Assessment");
const legacyHeaders = [...assessment.rows[0].slice(0, 10), "BP Systolic", "BP Diastolic", ...assessment.rows[0].slice(11)];
legacy.appendRow(legacyHeaders);
legacy.appendRow([...assessment.rows[1].slice(0, 10), 118, 76, ...assessment.rows[1].slice(11)]);
api.migrateSplitBpColumns_(legacy);
assert.equal(legacy.rows[0].length, 27);
assert.equal(legacy.rows[0][10], "BP");
assert.equal(legacy.rows[1][10], "118/76");

console.log(JSON.stringify({
  tabs: spreadsheet.sheets.size,
  columns: assessment.rows[0].length,
  records: assessment.rows.length - 1,
  lastColumn: assessment.rows[0][26],
  bp: assessment.rows[1][10],
  normalPpp: assessment.rows[1][26],
  notDonePpp: assessment.rows[2][26],
  migratedBp: legacy.rows[1][10],
  normalizedDate: listed[0].date,
  iframeTransport: true
}));
