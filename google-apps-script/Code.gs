const ASTHMA_CONFIG = Object.freeze({
  // Kosongkan jika skrip ini dibina terus dari Extensions > Apps Script
  // dalam Google Sheet yang hendak digunakan.
  SPREADSHEET_ID: "",
  ASSESSMENT_SHEET: "Asthma_Assessment",
  MONTHLY_SHEET: "Asthma_Monthly_View",
  YEARLY_SHEET: "Asthma_Yearly_View",
  LEGACY_SHEETS: ["Asthma_Dashboard", "PEFR_Reference"]
});

const ASSESSMENT_HEADERS = Object.freeze([
  "Record ID", "Timestamp", "Tarikh", "Masa", "Kategori Pesakit",
  "Nama Pesakit", "IC/RN", "Umur", "Jantina", "Tinggi (cm)",
  "BP", "HR", "RR", "Temperature", "SpO2", "PEFR Ideal",
  "PEFR Before", "Percentage Before", "Category Before", "PEFR After",
  "Percentage After", "Category After", "Uptriage", "PEFR Not Done",
  "Not Done Reason", "Not Done Other", "Nama PPP"
]);

const LEGACY_SPLIT_BP_HEADERS = Object.freeze([
  ...ASSESSMENT_HEADERS.slice(0, 10),
  "BP Systolic", "BP Diastolic",
  ...ASSESSMENT_HEADERS.slice(11)
]);

/** Jalankan sekali selepas mengganti Code.gs. */
function setupAsthmaSheets() {
  const spreadsheet = getSpreadsheet_();
  setupAssessmentSheet_(spreadsheet);
  setupMonthlySheet_(spreadsheet);
  setupYearlySheet_(spreadsheet);
  removeLegacySheets_(spreadsheet);
  return {
    spreadsheetId: spreadsheet.getId(),
    sheets: [
      ASTHMA_CONFIG.ASSESSMENT_SHEET,
      ASTHMA_CONFIG.MONTHLY_SHEET,
      ASTHMA_CONFIG.YEARLY_SHEET
    ]
  };
}

function doGet(e) {
  try {
    const parameters = (e && e.parameter) || {};
    const action = String(parameters.action || "health");
    let payload;

    if (action === "health") {
      payload = { ok: true, service: "A.M.O ETD LEPEH Asthma Sheet API" };
    } else if (action === "listAsthmaAssessments") {
      payload = { ok: true, records: listAsthmaAssessments_() };
    } else {
      payload = { ok: false, error: "Unsupported action" };
    }

    const callback = clean_(parameters.callback);
    return callback ? javascript_(callback, payload) : json_(payload);
  } catch (error) {
    const parameters = (e && e.parameter) || {};
    const payload = { ok: false, error: String(error && error.message || error) };
    const callback = clean_(parameters.callback);
    return callback ? javascript_(callback, payload) : json_(payload);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (payload.action !== "saveAsthmaAssessment") throw new Error("Unsupported action");
    const saved = saveAsthmaAssessment_(payload.record || {});
    return json_({ ok: true, recordId: saved.recordId, duplicate: saved.duplicate });
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
    if (!sheet) throw new Error("Jalankan setupAsthmaSheets() dahulu.");
    assertHeaders_(sheet, ASSESSMENT_HEADERS);

    const now = new Date();
    const requestedId = clean_(record.id);
    const recordId = requestedId || nextRecordId_(sheet, now);
    if (recordIdExists_(sheet, recordId)) return { recordId: recordId, duplicate: true };

    const notDone = Boolean(record.pefrNotDone);
    sheet.appendRow([
      recordId,
      validDate_(record.timestamp) || now,
      clean_(record.date), clean_(record.time),
      record.patientType === "paediatric" ? "Pediatrik" : "Dewasa",
      clean_(record.patientName), clean_(record.patientId), numberOrBlank_(record.age),
      record.sex === "female" ? "Perempuan" : "Lelaki",
      numberOrBlank_(record.height), bpValue_(record), numberOrBlank_(record.hr),
      numberOrBlank_(record.rr), numberOrBlank_(record.temperature), numberOrBlank_(record.spo2),
      numberOrBlank_(record.pefrIdeal),
      notDone ? "" : numberOrBlank_(record.pefrBefore),
      notDone ? "" : numberOrBlank_(record.percentageBefore),
      notDone ? "Not Done" : clean_(record.categoryBefore),
      notDone ? "" : numberOrBlank_(record.pefrAfter),
      notDone ? "" : numberOrBlank_(record.percentageAfter),
      notDone ? "Not Done" : clean_(record.categoryAfter),
      clean_(record.uptriage || "None"), notDone,
      notDone ? clean_(record.notDoneReason) : "",
      notDone ? clean_(record.notDoneOther) : "",
      clean_(record.pppName)
    ]);
    SpreadsheetApp.flush();
    return { recordId: recordId, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function listAsthmaAssessments_() {
  const sheet = getSpreadsheet_().getSheetByName(ASTHMA_CONFIG.ASSESSMENT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  assertHeaders_(sheet, ASSESSMENT_HEADERS);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ASSESSMENT_HEADERS.length).getValues();
  return rows.map(function (row) {
    return {
      id: clean_(row[0]),
      timestamp: isoDate_(row[1]),
      date: clean_(row[2]),
      time: clean_(row[3]),
      patientType: clean_(row[4]) === "Pediatrik" ? "paediatric" : "adult",
      patientName: clean_(row[5]), patientId: clean_(row[6]),
      age: numberOrNull_(row[7]), sex: clean_(row[8]) === "Perempuan" ? "female" : "male",
      height: numberOrNull_(row[9]), bp: clean_(row[10]), hr: numberOrNull_(row[11]),
      rr: numberOrNull_(row[12]), temperature: numberOrNull_(row[13]), spo2: numberOrNull_(row[14]),
      pefrIdeal: numberOrNull_(row[15]), pefrBefore: numberOrNull_(row[16]),
      percentageBefore: numberOrNull_(row[17]), categoryBefore: clean_(row[18]),
      pefrAfter: numberOrNull_(row[19]), percentageAfter: numberOrNull_(row[20]),
      categoryAfter: clean_(row[21]), uptriage: clean_(row[22]) || "None",
      pefrNotDone: Boolean(row[23]), notDoneReason: clean_(row[24]),
      notDoneOther: clean_(row[25]), pppName: clean_(row[26]), syncStatus: "submitted"
    };
  });
}

function setupAssessmentSheet_(spreadsheet) {
  const sheet = getOrCreateSheet_(spreadsheet, ASTHMA_CONFIG.ASSESSMENT_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ASSESSMENT_HEADERS.length).setValues([ASSESSMENT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, ASSESSMENT_HEADERS.length)
      .setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
    sheet.getRange("B:B").setNumberFormat("dd/MM/yyyy HH:mm:ss");
    sheet.getRange(1, 1, sheet.getMaxRows(), ASSESSMENT_HEADERS.length).createFilter();
    sheet.autoResizeColumns(1, ASSESSMENT_HEADERS.length);
  } else if (headersMatch_(sheet, LEGACY_SPLIT_BP_HEADERS)) {
    migrateSplitBpColumns_(sheet);
  } else {
    assertHeaders_(sheet, ASSESSMENT_HEADERS);
    if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), ASSESSMENT_HEADERS.length).createFilter();
  }
}

function migrateSplitBpColumns_(sheet) {
  const dataRows = sheet.getLastRow() - 1;
  if (dataRows > 0) {
    const values = sheet.getRange(2, 11, dataRows, 2).getValues();
    sheet.getRange(2, 11, dataRows, 1).setValues(values.map(function (row) {
      const systolic = clean_(row[0]);
      const diastolic = clean_(row[1]);
      return [systolic && diastolic ? systolic + "/" + diastolic : systolic || diastolic];
    }));
  }
  sheet.deleteColumn(12);
  sheet.getRange(1, 11).setValue("BP");
  assertHeaders_(sheet, ASSESSMENT_HEADERS);
}

function setupMonthlySheet_(spreadsheet) {
  const name = ASTHMA_CONFIG.MONTHLY_SHEET;
  const sheet = getOrCreateSheet_(spreadsheet, name);
  sheet.clear();
  const source = ASTHMA_CONFIG.ASSESSMENT_SHEET;
  const now = new Date();
  sheet.getRange("A1:B1").setValues([["PAPARAN BULANAN ASMA", "Nilai"]])
    .setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  sheet.getRange("A2:B4").setValues([
    ["Bulan (1-12)", now.getMonth() + 1],
    ["Tahun", now.getFullYear()],
    ["Kod Bulan", '=TEXT(DATE(B3,B2,1),"yyyy-mm")']
  ]);
  const prefix = '$B$4&"*"';
  const rows = [
    ["Jumlah Penilaian", `=COUNTIF('${source}'!C2:C,${prefix})`],
    ["Dewasa", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!E2:E,"Dewasa")`],
    ["Pediatrik", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!E2:E,"Pediatrik")`],
    ["Mild Before", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!S2:S,"Mild")`],
    ["Moderate Before", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!S2:S,"Moderate")`],
    ["Severe Before", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!S2:S,"Severe")`],
    ["Mild After", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!V2:V,"Mild")`],
    ["Moderate After", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!V2:V,"Moderate")`],
    ["Severe After", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!V2:V,"Severe")`],
    ["Uptriage Yellow", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!W2:W,"Yellow Zone")`],
    ["Uptriage Red", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!W2:W,"Red Zone")`],
    ["PEFR Not Done", `=COUNTIFS('${source}'!C2:C,${prefix},'${source}'!X2:X,TRUE)`]
  ];
  sheet.getRange(6, 1, rows.length, 2).setValues(rows);
  sheet.getRange("D1").setValue("SENARAI REKOD BULAN DIPILIH").setFontWeight("bold");
  sheet.getRange("D2").setFormula(`=IFERROR(QUERY('${source}'!A:AA,"select * where C starts with '"&$B$4&"'",1),"Tiada rekod")`);
  sheet.getRange("B2").setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 12).build());
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 5);
}

function setupYearlySheet_(spreadsheet) {
  const sheet = getOrCreateSheet_(spreadsheet, ASTHMA_CONFIG.YEARLY_SHEET);
  sheet.clear();
  const source = ASTHMA_CONFIG.ASSESSMENT_SHEET;
  const year = new Date().getFullYear();
  sheet.getRange("A1:I1").setValues([["Bulan", "Jumlah", "Dewasa", "Pediatrik", "Mild After", "Moderate After", "Severe After", "Yellow", "Red"]])
    .setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  sheet.getRange("K1:L2").setValues([["PAPARAN TAHUNAN", "Nilai"], ["Tahun", year]]);
  sheet.getRange("K1:L1").setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
  const months = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
  const formulas = months.map(function (month, index) {
    const row = index + 2;
    const prefix = `TEXT(DATE($L$2,${index + 1},1),"yyyy-mm")&"*"`;
    return [
      month,
      `=COUNTIF('${source}'!C:C,${prefix})`,
      `=COUNTIFS('${source}'!C:C,${prefix},'${source}'!E:E,"Dewasa")`,
      `=COUNTIFS('${source}'!C:C,${prefix},'${source}'!E:E,"Pediatrik")`,
      `=COUNTIFS('${source}'!C:C,${prefix},'${source}'!V:V,"Mild")`,
      `=COUNTIFS('${source}'!C:C,${prefix},'${source}'!V:V,"Moderate")`,
      `=COUNTIFS('${source}'!C:C,${prefix},'${source}'!V:V,"Severe")`,
      `=COUNTIFS('${source}'!C:C,${prefix},'${source}'!W:W,"Yellow Zone")`,
      `=COUNTIFS('${source}'!C:C,${prefix},'${source}'!W:W,"Red Zone")`
    ];
  });
  sheet.getRange(2, 1, formulas.length, formulas[0].length).setValues(formulas);
  sheet.getRange("K4:L7").setValues([
    ["Jumlah Setahun", "=SUM(B2:B13)"],
    ["Purata Sebulan", "=AVERAGE(B2:B13)"],
    ["Bulan Tertinggi", '=INDEX(A2:A13,MATCH(MAX(B2:B13),B2:B13,0))'],
    ["Jumlah Uptriage", "=SUM(H2:H13)+SUM(I2:I13)"]
  ]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 12);
}

function removeLegacySheets_(spreadsheet) {
  ASTHMA_CONFIG.LEGACY_SHEETS.forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(sheet);
  });
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

function recordIdExists_(sheet, recordId) {
  if (!recordId || sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat().includes(recordId);
}

function nextRecordId_(sheet, date) {
  const datePart = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyyMMdd");
  const prefix = "AST-" + datePart + "-";
  const ids = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  return prefix + String(ids.filter(function (id) { return String(id).indexOf(prefix) === 0; }).length + 1).padStart(3, "0");
}

function getSpreadsheet_() {
  if (ASTHMA_CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(ASTHMA_CONFIG.SPREADSHEET_ID);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Tetapkan SPREADSHEET_ID atau gunakan bound Apps Script.");
  return spreadsheet;
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function assertHeaders_(sheet, headers) {
  if (!headersMatch_(sheet, headers)) throw new Error("Header " + sheet.getName() + " tidak sepadan. Jangan ubah susunan kolum.");
}

function headersMatch_(sheet, headers) {
  return sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0].join("|") === headers.join("|");
}

function validDate_(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate_(value) {
  const date = validDate_(value);
  return date ? date.toISOString() : clean_(value);
}

function numberOrBlank_(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function numberOrNull_(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bpValue_(record) {
  const combined = clean_(record.bp).replace(/\s+/g, "");
  if (combined) return combined;
  const systolic = numberOrBlank_(record.bpSys);
  const diastolic = numberOrBlank_(record.bpDia);
  return systolic !== "" && diastolic !== "" ? systolic + "/" + diastolic : "";
}

function clean_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function javascript_(callback, payload) {
  if (!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) throw new Error("Callback tidak sah.");
  return ContentService.createTextOutput(callback + "(" + JSON.stringify(payload) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
