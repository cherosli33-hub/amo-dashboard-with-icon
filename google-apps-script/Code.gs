const ASTHMA_CONFIG = Object.freeze({
  // Kosongkan jika skrip ini dibina terus dari Extensions > Apps Script
  // dalam Google Sheet yang hendak digunakan.
  SPREADSHEET_ID: "",
  ASSESSMENT_SHEET: "Asthma_Assessment",
  DASHBOARD_SHEET: "Asthma_Dashboard",
  REFERENCE_SHEET: "PEFR_Reference"
});

const ASSESSMENT_HEADERS = Object.freeze([
  "Record ID",
  "Timestamp",
  "Tarikh",
  "Masa",
  "Kategori Pesakit",
  "Nama Pesakit",
  "IC/RN",
  "Umur",
  "Jantina",
  "Tinggi (cm)",
  "BP Systolic",
  "BP Diastolic",
  "HR",
  "RR",
  "Temperature",
  "SpO2",
  "PEFR Ideal",
  "PEFR Before",
  "Percentage Before",
  "Category Before",
  "PEFR After",
  "Percentage After",
  "Category After",
  "Uptriage",
  "PEFR Not Done",
  "Not Done Reason",
  "Not Done Other",
  "Nama PPP"
]);

const PAEDIATRIC_REFERENCE = Object.freeze([
  [85, 87], [90, 95], [95, 104], [100, 115], [105, 127], [110, 141],
  [115, 157], [120, 174], [125, 192], [130, 212], [135, 233],
  [140, 254], [145, 276], [150, 299], [155, 323], [160, 346],
  [165, 370], [170, 393]
]);

/** Jalankan sekali dari Apps Script editor untuk menyediakan tiga tab Asma. */
function setupAsthmaSheets() {
  const spreadsheet = getSpreadsheet_();
  setupAssessmentSheet_(spreadsheet);
  setupDashboardSheet_(spreadsheet);
  setupReferenceSheet_(spreadsheet);
  return {
    spreadsheetId: spreadsheet.getId(),
    sheets: [
      ASTHMA_CONFIG.ASSESSMENT_SHEET,
      ASTHMA_CONFIG.DASHBOARD_SHEET,
      ASTHMA_CONFIG.REFERENCE_SHEET
    ]
  };
}

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || "health");
  if (action === "health") {
    return json_({ ok: true, service: "A.M.O ETD LEPEH Asthma Sheet API" });
  }
  return json_({ ok: false, error: "Unsupported action" });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (payload.action !== "saveAsthmaAssessment") {
      throw new Error("Unsupported action");
    }
    const saved = saveAsthmaAssessment_(payload.record || {});
    return json_({ ok: true, recordId: saved.recordId });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}

function saveAsthmaAssessment_(record) {
  validateRecord_(record);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getSpreadsheet_();
    const sheet = spreadsheet.getSheetByName(ASTHMA_CONFIG.ASSESSMENT_SHEET);
    if (!sheet) {
      throw new Error("Jalankan setupAsthmaSheets() dahulu.");
    }
    assertHeaders_(sheet, ASSESSMENT_HEADERS);
    const now = new Date();
    const recordId = nextRecordId_(sheet, now);
    const notDone = Boolean(record.pefrNotDone);
    sheet.appendRow([
      recordId,
      validDate_(record.timestamp) || now,
      clean_(record.date),
      clean_(record.time),
      record.patientType === "paediatric" ? "Pediatrik" : "Dewasa",
      clean_(record.patientName),
      clean_(record.patientId),
      numberOrBlank_(record.age),
      record.sex === "female" ? "Perempuan" : "Lelaki",
      numberOrBlank_(record.height),
      numberOrBlank_(record.bpSys),
      numberOrBlank_(record.bpDia),
      numberOrBlank_(record.hr),
      numberOrBlank_(record.rr),
      numberOrBlank_(record.temperature),
      numberOrBlank_(record.spo2),
      numberOrBlank_(record.pefrIdeal),
      notDone ? "" : numberOrBlank_(record.pefrBefore),
      notDone ? "" : numberOrBlank_(record.percentageBefore),
      notDone ? "Not Done" : clean_(record.categoryBefore),
      notDone ? "" : numberOrBlank_(record.pefrAfter),
      notDone ? "" : numberOrBlank_(record.percentageAfter),
      notDone ? "Not Done" : clean_(record.categoryAfter),
      clean_(record.uptriage || "None"),
      notDone,
      notDone ? clean_(record.notDoneReason) : "",
      notDone ? clean_(record.notDoneOther) : "",
      clean_(record.pppName)
    ]);
    return { recordId: recordId };
  } finally {
    lock.releaseLock();
  }
}

function setupAssessmentSheet_(spreadsheet) {
  const sheet = getOrCreateSheet_(spreadsheet, ASTHMA_CONFIG.ASSESSMENT_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ASSESSMENT_HEADERS.length).setValues([ASSESSMENT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, ASSESSMENT_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#0f766e")
      .setFontColor("#ffffff");
    sheet.getRange("B:B").setNumberFormat("dd/MM/yyyy HH:mm:ss");
    sheet.autoResizeColumns(1, ASSESSMENT_HEADERS.length);
  } else {
    assertHeaders_(sheet, ASSESSMENT_HEADERS);
  }
}

function setupDashboardSheet_(spreadsheet) {
  const sheet = getOrCreateSheet_(spreadsheet, ASTHMA_CONFIG.DASHBOARD_SHEET);
  if (sheet.getLastRow() > 0) return;
  const source = ASTHMA_CONFIG.ASSESSMENT_SHEET;
  const rows = [
    ["RINGKASAN PENILAIAN ASMA", "Nilai"],
    ["Jumlah Penilaian", `=COUNTA('${source}'!A2:A)`],
    ["Dewasa", `=COUNTIF('${source}'!E2:E,"Dewasa")`],
    ["Pediatrik", `=COUNTIF('${source}'!E2:E,"Pediatrik")`],
    ["Mild Before", `=COUNTIF('${source}'!T2:T,"Mild")`],
    ["Moderate Before", `=COUNTIF('${source}'!T2:T,"Moderate")`],
    ["Severe Before", `=COUNTIF('${source}'!T2:T,"Severe")`],
    ["Mild After", `=COUNTIF('${source}'!W2:W,"Mild")`],
    ["Moderate After", `=COUNTIF('${source}'!W2:W,"Moderate")`],
    ["Severe After", `=COUNTIF('${source}'!W2:W,"Severe")`],
    ["Uptriage Yellow Zone", `=COUNTIF('${source}'!X2:X,"Yellow Zone")`],
    ["Uptriage Red Zone", `=COUNTIF('${source}'!X2:X,"Red Zone")`],
    ["PEFR Not Done", `=COUNTIF('${source}'!Y2:Y,TRUE)`]
  ];
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange("A1:B1").setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  sheet.autoResizeColumns(1, 2);
}

function setupReferenceSheet_(spreadsheet) {
  const sheet = getOrCreateSheet_(spreadsheet, ASTHMA_CONFIG.REFERENCE_SHEET);
  if (sheet.getLastRow() > 0) return;
  const adultRows = buildAdultReference_();
  const rows = [
    ["RUJUKAN PEFR DEWASA EU/EN13826", "", "", ""],
    ["Umur", "Jantina", "Tinggi (cm)", "PEFR Ideal (L/min)"],
    ...adultRows,
    ["", "", "", ""],
    ["RUJUKAN PEFR PEDIATRIK EU/EN13826", "", "", ""],
    ["Tinggi (cm)", "PEFR Ideal (L/min)", "", ""],
    ...PAEDIATRIC_REFERENCE.map(row => [row[0], row[1], "", ""])
  ];
  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.getRange("A1:D1").merge().setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  const paediatricTitleRow = adultRows.length + 4;
  sheet.getRange(paediatricTitleRow, 1, 1, 4).merge().setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  sheet.getRange(2, 1, 1, 4).setFontWeight("bold");
  sheet.getRange(paediatricTitleRow + 1, 1, 1, 2).setFontWeight("bold");
  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, 4);
}

function buildAdultReference_() {
  const ages = [];
  for (let age = 15; age <= 85; age += 5) ages.push(age);
  const rows = [];
  const heights = {
    Lelaki: [160, 167, 175, 183, 190],
    Perempuan: [152, 160, 167, 175, 183]
  };
  Object.keys(heights).forEach(function (sex) {
    heights[sex].forEach(function (height) {
      ages.forEach(function (age) {
        rows.push([age, sex, height, predictedAdultPef_(age, sex, height)]);
      });
    });
  });
  return rows;
}

function predictedAdultPef_(age, sex, heightCm) {
  const logWright = sex === "Lelaki"
    ? (0.544 * Math.log(age)) - (0.0151 * age) - (74.7 / heightCm) + 5.48
    : (0.376 * Math.log(age)) - (0.012 * age) - (58.8 / heightCm) + 5.63;
  const wright = Math.exp(logWright);
  const eu = 50.356 + (0.4 * wright) + (0.0008814 * Math.pow(wright, 2)) - (0.0000001116 * Math.pow(wright, 3));
  return Math.round(eu);
}

function validateRecord_(record) {
  if (!record || typeof record !== "object") throw new Error("Rekod tidak sah.");
  if (!clean_(record.patientId)) throw new Error("IC/RN diperlukan.");
  if (!clean_(record.pppName)) throw new Error("Nama PPP diperlukan.");
  if (!["adult", "paediatric"].includes(record.patientType)) throw new Error("Kategori pesakit tidak sah.");
  if (!record.pefrNotDone) {
    ["pefrIdeal", "pefrBefore", "percentageBefore", "pefrAfter", "percentageAfter"].forEach(function (field) {
      if (!Number.isFinite(Number(record[field]))) throw new Error(field + " diperlukan.");
    });
  } else if (!clean_(record.notDoneReason)) {
    throw new Error("Sebab PEFR Not Done diperlukan.");
  }
}

function nextRecordId_(sheet, date) {
  const datePart = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyyMMdd");
  const prefix = "AST-" + datePart + "-";
  const ids = sheet.getLastRow() < 2
    ? []
    : sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  const sequence = ids.filter(function (id) { return String(id).indexOf(prefix) === 0; }).length + 1;
  return prefix + String(sequence).padStart(3, "0");
}

function getSpreadsheet_() {
  if (ASTHMA_CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(ASTHMA_CONFIG.SPREADSHEET_ID);
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Tetapkan SPREADSHEET_ID atau gunakan bound Apps Script.");
  return spreadsheet;
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function assertHeaders_(sheet, headers) {
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (actual.join("|") !== headers.join("|")) {
    throw new Error("Header " + sheet.getName() + " tidak sepadan. Jangan ubah susunan kolum.");
  }
}

function validDate_(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrBlank_(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function clean_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
