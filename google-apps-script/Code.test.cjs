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
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setNumberFormat() { return this; }
  merge() { return this; }
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
}

const spreadsheet = new Spreadsheet();
const context = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { formatDate: date => date.toISOString().slice(0, 10).replaceAll("-", "") },
  Session: { getScriptTimeZone: () => "Asia/Kuala_Lumpur" },
  ContentService: {
    MimeType: { JSON: "json" },
    createTextOutput: text => ({ text, setMimeType() { return this; } })
  }
};

const source = fs.readFileSync(path.join(__dirname, "Code.gs"), "utf8") +
  "\n;globalThis.__api={setupAsthmaSheets,saveAsthmaAssessment_,doPost};";
vm.runInNewContext(source, context);
const api = context.__api;

api.setupAsthmaSheets();
assert.deepEqual([...spreadsheet.sheets.keys()], ["Asthma_Assessment", "Asthma_Dashboard", "PEFR_Reference"]);

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
  bpSys: 120,
  bpDia: 80,
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
assert.equal(assessment.rows[0].length, 28);
assert.equal(assessment.rows[1].length, 28);
assert.match(assessment.rows[1][0], /^AST-20260716-001$/);
assert.match(assessment.rows[2][0], /^AST-20260716-002$/);
assert.equal(assessment.rows[1][27], "PPP Rosli");
assert.equal(assessment.rows[2][27], "PPP Aminah");
assert.equal(assessment.rows[2][4], "Pediatrik");
assert.equal(assessment.rows[2][17], "");
assert.equal(assessment.rows[2][24], true);
assert.equal(assessment.rows[2][25], "Unable");

const dashboard = spreadsheet.getSheetByName("Asthma_Dashboard");
assert.match(dashboard.rows[1][1], /COUNTA/);
assert.match(dashboard.rows[12][1], /Y2:Y,TRUE/);

const reference = spreadsheet.getSheetByName("PEFR_Reference");
assert.ok(reference.rows.some(row => row[0] === 130 && row[1] === 212));

console.log(JSON.stringify({
  tabs: spreadsheet.sheets.size,
  columns: assessment.rows[0].length,
  records: assessment.rows.length - 1,
  lastColumn: assessment.rows[0][27],
  normalPpp: assessment.rows[1][27],
  notDonePpp: assessment.rows[2][27]
}));
