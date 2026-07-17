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
  const parameters = (e && e.parameter) || {};
  try {
    const action = String(parameters.action || "health");
    let payload;

    if (action === "health") {
      payload = { ok: true, service: "A.M.O ETD LEPEH Asthma Sheet API" };
    } else if (action === "listAsthmaAssessments") {
      payload = { ok: true, records: listAsthmaAssessments_() };
    } else {
      payload = { ok: false, error: "Unsupported action" };
    }

    return response_(parameters, payload);
  } catch (error) {
    const payload = { ok: false, error: String(error && error.message || error) };
    return response_(parameters, payload);
  }
}

function doPost(e) {
  const parameters = (e && e.parameter) || {};
  try {
    const body = parameters.payload || (e && e.postData && e.postData.contents) || "{}";
    const payload = JSON.parse(body);
    if (payload.action !== "saveAsthmaAssessment") throw new Error("Unsupported action");
    const saved = saveAsthmaAssessment_(payload.record || {});
    return response_(parameters, { ok: true, recordId: saved.recordId, duplicate: saved.duplicate });
  } catch (error) {
    console.error(error);
    return response_(parameters, { ok: false, error: String(error && error.message || error) });
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
    const rowValues = [
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
    ];
    const targetRow = lastRecordRow_(sheet) + 1;
    if (targetRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), targetRow - sheet.getMaxRows());
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    setNotDoneCheckbox_(sheet, targetRow);
    SpreadsheetApp.flush();
    return { recordId: recordId, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function listAsthmaAssessments_() {
  const sheet = getSpreadsheet_().getSheetByName(ASTHMA_CONFIG.ASSESSMENT_SHEET);
  if (!sheet) return [];
  assertHeaders_(sheet, ASSESSMENT_HEADERS);
  const lastRow = lastRecordRow_(sheet);
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, ASSESSMENT_HEADERS.length).getValues();
  return rows.map(function (row) {
    return {
      id: clean_(row[0]),
      timestamp: isoDate_(row[1]),
      date: dateKey_(row[2], row[1]),
      time: clean_(row[3]),
      patientType: clean_(row[4]) === "Pediatrik" ? "paediatric" : "adult",
      patientName: clean_(row[5]), patientId: clean_(row[6]),
      age: numberOrNull_(row[7]), sex: clean_(row[8]) === "Perempuan" ? "female" : "male",
      height: numberOrNull_(row[9]), bp: clean_(row[10]),
      bpSys: splitBp_(row[10]).systolic, bpDia: splitBp_(row[10]).diastolic,
      hr: numberOrNull_(row[11]),
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
  setupNotDoneCheckbox_(sheet);
  sheet.hideColumns(1);
}

function setupNotDoneCheckbox_(sheet) {
  const pefrNotDoneColumn = ASSESSMENT_HEADERS.indexOf("PEFR Not Done") + 1;
  const lastRow = lastRecordRow_(sheet);
  if (lastRow < 2) return;
  sheet.getRange(2, pefrNotDoneColumn, lastRow - 1, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
    .setHorizontalAlignment("center");
}

function setNotDoneCheckbox_(sheet, row) {
  const column = ASSESSMENT_HEADERS.indexOf("PEFR Not Done") + 1;
  sheet.getRange(row, column)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
    .setHorizontalAlignment("center");
}

function lastRecordRow_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (clean_(ids[index][0])) return index + 2;
  }
  return 1;
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
  const monthStart = "DATE($B$3,$B$2,1)";
  const monthEnd = `EDATE(${monthStart},1)`;
  const dateCriteria = `'${source}'!C2:C,">="&${monthStart},'${source}'!C2:C,"<"&${monthEnd}`;
  const rows = [
    ["Jumlah Penilaian", `=COUNTIFS(${dateCriteria})`],
    ["Dewasa", `=COUNTIFS(${dateCriteria},'${source}'!E2:E,"Dewasa")`],
    ["Pediatrik", `=COUNTIFS(${dateCriteria},'${source}'!E2:E,"Pediatrik")`],
    ["Mild Before", `=COUNTIFS(${dateCriteria},'${source}'!S2:S,"Mild")`],
    ["Moderate Before", `=COUNTIFS(${dateCriteria},'${source}'!S2:S,"Moderate")`],
    ["Severe Before", `=COUNTIFS(${dateCriteria},'${source}'!S2:S,"Severe")`],
    ["Mild After", `=COUNTIFS(${dateCriteria},'${source}'!V2:V,"Mild")`],
    ["Moderate After", `=COUNTIFS(${dateCriteria},'${source}'!V2:V,"Moderate")`],
    ["Severe After", `=COUNTIFS(${dateCriteria},'${source}'!V2:V,"Severe")`],
    ["Uptriage Yellow", `=COUNTIFS(${dateCriteria},'${source}'!W2:W,"Yellow Zone")`],
    ["Uptriage Red", `=COUNTIFS(${dateCriteria},'${source}'!W2:W,"Red Zone")`],
    ["PEFR Not Done", `=COUNTIFS(${dateCriteria},'${source}'!X2:X,TRUE)`]
  ];
  sheet.getRange(6, 1, rows.length, 2).setValues(rows);
  sheet.getRange("D1").setValue("SENARAI REKOD BULAN DIPILIH").setFontWeight("bold");
  sheet.getRange("D2").setFormula(`=IFERROR({'${source}'!A1:AA1;FILTER('${source}'!A2:AA,'${source}'!C2:C>=${monthStart},'${source}'!C2:C<${monthEnd})},"Tiada rekod")`);
  sheet.hideColumns(4);
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
    const monthStart = `DATE($L$2,${index + 1},1)`;
    const monthEnd = `EDATE(${monthStart},1)`;
    const dateCriteria = `'${source}'!C:C,">="&${monthStart},'${source}'!C:C,"<"&${monthEnd}`;
    return [
      month,
      `=COUNTIFS(${dateCriteria})`,
      `=COUNTIFS(${dateCriteria},'${source}'!E:E,"Dewasa")`,
      `=COUNTIFS(${dateCriteria},'${source}'!E:E,"Pediatrik")`,
      `=COUNTIFS(${dateCriteria},'${source}'!V:V,"Mild")`,
      `=COUNTIFS(${dateCriteria},'${source}'!V:V,"Moderate")`,
      `=COUNTIFS(${dateCriteria},'${source}'!V:V,"Severe")`,
      `=COUNTIFS(${dateCriteria},'${source}'!W:W,"Yellow Zone")`,
      `=COUNTIFS(${dateCriteria},'${source}'!W:W,"Red Zone")`
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
  const lastRow = lastRecordRow_(sheet);
  if (!recordId || lastRow < 2) return false;
  return sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat().includes(recordId);
}

function nextRecordId_(sheet, date) {
  const datePart = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyyMMdd");
  const prefix = "AST-" + datePart + "-";
  const lastRow = lastRecordRow_(sheet);
  const ids = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
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

function dateKey_(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const text = clean_(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + "-" + match[2] + "-" + match[3];
  const parsed = validDate_(text) || validDate_(fallback);
  return parsed ? Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd") : "";
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

function splitBp_(value) {
  const parts = clean_(value).split("/");
  return {
    systolic: numberOrNull_(parts[0]),
    diastolic: numberOrNull_(parts[1])
  };
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

function response_(parameters, payload) {
  if (clean_(parameters.transport) === "iframe") {
    return iframeResponse_(clean_(parameters.requestId), payload);
  }
  const callback = clean_(parameters.callback);
  return callback ? javascript_(callback, payload) : json_(payload);
}

function iframeResponse_(requestId, payload) {
  if (!/^[0-9A-Za-z-]{1,100}$/.test(requestId)) throw new Error("Request ID tidak sah.");
  const message = JSON.stringify({
    channel: "amo-asthma-sheet",
    requestId: requestId,
    payload: payload
  }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const html = "<!doctype html><meta charset=\"utf-8\"><script>window.top.postMessage(" + message + ",\"*\");<\/script>";
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
