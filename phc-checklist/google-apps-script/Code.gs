const APP_VERSION = '2.5.9';
const TIME_ZONE = 'Asia/Kuala_Lumpur';
const SHEETS = Object.freeze({
  inspections: 'PEMERIKSAAN',
  checks: 'ITEM CHECK',
  findings: 'PENEMUAN',
  master: 'MASTER ITEM',
});
const MONTHS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
const VALID_BAGS = ['PHC 1','PHC 2'];
const VALID_SHIFTS = ['Pagi','Petang','Malam'];

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'health');
    if (action === 'health') return json_(health_());
    if (action === 'records') return json_({ok:true, records:getRecords_(e.parameter.from, e.parameter.to)});
    if (action === 'findings') return json_({ok:true, findings:getFindings_(e.parameter.from, e.parameter.to, String(e.parameter.all || '') === '1')});
    if (action === 'dashboard') return json_(getDashboard_(e.parameter.from, e.parameter.to));
    return json_({ok:false, message:'Tindakan tidak dikenali.'});
  } catch (error) {
    return json_({ok:false, message:error.message || String(error)});
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.action === 'saveInspection') return json_(saveInspection_(payload.record, payload.appVersion));
    if (payload.action === 'resolveFinding') return json_(resolveFinding_(payload.findingId, payload.resolution, payload.status));
    return json_({ok:false, message:'Tindakan tidak dikenali.'});
  } catch (error) {
    return json_({ok:false, message:error.message || String(error)});
  }
}

function resolveFinding_(findingId, resolution, resolutionStatus) {
  const id = safeText_(findingId, 100);
  const status = safeText_(resolutionStatus || 'Telah diambil tindakan', 40);
  const allowedStatuses = ['Telah diambil tindakan','Telah diambil maklum'];
  if (!allowedStatuses.includes(status)) throw new Error('Status tindakan tidak sah.');
  const action = safeText_(resolution || status, 200);
  if (!id || !action) throw new Error('ID penemuan dan tindakan diperlukan.');
  const spreadsheet = getSpreadsheet_();
  const sheet = requiredSheet_(spreadsheet, SHEETS.findings);
  if (sheet.getLastRow() < 2) throw new Error('Penemuan tidak ditemui.');
  const match = sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).findNext();
  if (!match) throw new Error('Penemuan tidak ditemui.');
  sheet.getRange(match.getRow(),11,1,4).setValues([[
    action, new Date(), sheet.getRange(match.getRow(),13).getValue(), status
  ]]);
  sheet.getRange(match.getRow(),12).setNumberFormat('yyyy-mm-dd HH:mm');
  SpreadsheetApp.flush();
  return {ok:true, findingId:id, status:status, savedAt:new Date().toISOString()};
}

function saveInspection_(record, clientVersion) {
  const checked = validateRecord_(record);
  const spreadsheet = getSpreadsheet_();
  const inspectionSheet = requiredSheet_(spreadsheet, SHEETS.inspections);
  const checkSheet = requiredSheet_(spreadsheet, SHEETS.checks);
  const findingSheet = requiredSheet_(spreadsheet, SHEETS.findings);
  const master = loadMaster_(spreadsheet, checked.bag);
  const items = flattenItems_(checked, master);
  const expected = checked.bag === 'PHC 1' ? 78 : 75;
  if (items.length !== expected) throw new Error(`Bilangan item ${checked.bag} tidak tepat. Dijangka ${expected}, diterima ${items.length}.`);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const date = parseIsoDate_(checked.date);
    const timestamp = new Date(checked.savedAt);
    const dateParts = checked.date.split('-').map(Number);
    const monthNumber = dateParts[1];
    const monthName = MONTHS[monthNumber - 1];
    const shortageCount = items.filter(item => item.qty < item.standard).length;
    const inspectionRow = [
      checked.id, checked.checkKey, timestamp, date, monthName, monthNumber, date.getFullYear(),
      checked.bag, checked.shift, checked.ppp, items.length, shortageCount, checked.notes,
      'SYNCED', safeText_(clientVersion || APP_VERSION, 30),
    ];

    const existing = findRowByValue_(inspectionSheet, 2, checked.checkKey);
    if (existing) {
      const oldId = String(inspectionSheet.getRange(existing, 1).getValue());
      deleteRowsByValue_(checkSheet, 1, oldId);
      deleteRowsByValue_(findingSheet, 2, oldId);
      inspectionSheet.getRange(existing, 1, 1, inspectionRow.length).setValues([inspectionRow]);
    } else {
      inspectionSheet.appendRow(inspectionRow);
    }

    const checkRows = items.map(item => [
      checked.id, checked.checkKey, timestamp, date, monthName, monthNumber, date.getFullYear(),
      checked.bag, checked.shift, checked.ppp, item.categoryId, item.categoryName, item.name,
      item.standard, item.qty, item.standard - item.qty, item.qty < item.standard ? 'KURANG' : 'LENGKAP',
      safeText_(clientVersion || APP_VERSION, 30),
    ]);
    appendRows_(checkSheet, checkRows);

    const findingRows = items.filter(item => item.qty < item.standard).map((item, index) => [
      `${checked.id}-F${String(index + 1).padStart(3, '0')}`, checked.id, date, monthName,
      monthNumber, date.getFullYear(), `${checked.bag} / ${checked.shift}`, item.name,
      item.qty, item.standard, '', '', '', 'Belum diambil tindakan',
    ]);
    if (checked.notes) {
      findingRows.push([
        `${checked.id}-NOTE`, checked.id, date, monthName, monthNumber, date.getFullYear(),
        `${checked.bag} / ${checked.shift}`, 'Catatan pengguna', '', '', '', '', checked.notes,
        'Belum diambil tindakan',
      ]);
    }
    appendRows_(findingSheet, findingRows);
    SpreadsheetApp.flush();
    return {ok:true, id:checked.id, savedAt:new Date().toISOString(), itemCount:items.length, findingCount:findingRows.length};
  } finally {
    lock.releaseLock();
  }
}

function getDashboard_(fromText, toText) {
  const spreadsheet = getSpreadsheet_();
  return {
    ok:true,
    version:APP_VERSION,
    records:getRecords_(fromText, toText, spreadsheet, true),
    findings:getFindings_(fromText, toText, true, spreadsheet),
  };
}

function getRecords_(fromText, toText, sourceSpreadsheet, latestInventoryOnly) {
  const spreadsheet = sourceSpreadsheet || getSpreadsheet_();
  const inspectionSheet = requiredSheet_(spreadsheet, SHEETS.inspections);
  const checkSheet = requiredSheet_(spreadsheet, SHEETS.checks);
  const fromKey = fromText ? safeText_(fromText, 10) : '2000-01-01';
  const toKey = toText ? safeText_(toText, 10) : '2100-12-31';
  parseIsoDate_(fromKey); parseIsoDate_(toKey);
  const rows = dataRows_(inspectionSheet, 15).filter(row => row[0]);
  const selectedAll = rows.filter(row => {
    const dateKey = formatIsoDate_(row[3]); return dateKey >= fromKey && dateKey <= toKey;
  });
  const selectedMap = {};
  selectedAll.forEach(row => {
    const key = String(row[1]);
    const current = selectedMap[key];
    if (!current || normaliseDate_(row[2]).getTime() > normaliseDate_(current[2]).getTime()) selectedMap[key] = row;
  });
  const selected = Object.values(selectedMap);
  let ids = new Set(selected.map(row => String(row[0])));
  if (latestInventoryOnly) {
    const latestByBag = {};
    selected.forEach(row => {
      const bag = String(row[7]);
      if (!latestByBag[bag] || normaliseDate_(row[2]).getTime() > normaliseDate_(latestByBag[bag][2]).getTime()) latestByBag[bag] = row;
    });
    ids = new Set(Object.values(latestByBag).map(row => String(row[0])));
  }
  const itemRows = dataRows_(checkSheet, 18).filter(row => ids.has(String(row[0])));
  const quantitiesById = {};
  itemRows.forEach(row => {
    const id = String(row[0]); const categoryId = String(row[10]);
    quantitiesById[id] = quantitiesById[id] || {};
    quantitiesById[id][categoryId] = quantitiesById[id][categoryId] || {items:[]};
    quantitiesById[id][categoryId].items.push({name:String(row[12]), standard:Number(row[13]), qty:Number(row[14])});
  });
  return selected.map(row => ({
    id:String(row[0]), checkKey:String(row[1]), savedAt:normaliseDateTime_(row[2]), date:formatIsoDate_(row[3]),
    time:Utilities.formatDate(normaliseDate_(row[2]), TIME_ZONE, 'HH:mm'),
    bag:String(row[7]), shift:String(row[8]), ppp:String(row[9]), notes:String(row[12] || ''),
    syncStatus:'SYNCED', appVersion:String(row[14] || ''), quantities:quantitiesById[String(row[0])] || {},
  }));
}

function health_() {
  const spreadsheet = getSpreadsheet_();
  return {
    ok:true, app:'PHC Checklist', version:APP_VERSION, time:new Date().toISOString(),
    idTail:spreadsheet.getId().slice(-8),
    timeZone:spreadsheet.getSpreadsheetTimeZone() || TIME_ZONE,
    inspectionRows:Math.max(0, requiredSheet_(spreadsheet, SHEETS.inspections).getLastRow() - 1),
    findingRows:Math.max(0, requiredSheet_(spreadsheet, SHEETS.findings).getLastRow() - 1),
  };
}

function getFindings_(fromText, toText, includeAll, sourceSpreadsheet) {
  const spreadsheet = sourceSpreadsheet || getSpreadsheet_();
  const sheet = requiredSheet_(spreadsheet, SHEETS.findings);
  const fromKey = fromText ? safeText_(fromText, 10) : '2000-01-01';
  const toKey = toText ? safeText_(toText, 10) : '2100-12-31';
  parseIsoDate_(fromKey); parseIsoDate_(toKey);
  return dataRows_(sheet, 14).filter(row => {
    const dateKey = formatIsoDate_(row[2]);
    return row[0] && (includeAll || String(row[7]) === 'Catatan pengguna') && dateKey >= fromKey && dateKey <= toKey;
  }).map(row => ({
    type:String(row[7]) === 'Catatan pengguna' ? 'note' : 'shortage',
    id:String(row[0]), inspectionId:String(row[1]), date:formatIsoDate_(row[2]),
    bagShift:String(row[6]), item:String(row[7]) === 'Catatan pengguna' ? '' : String(row[7] || ''),
    qty:String(row[7]) === 'Catatan pengguna' ? null : Number(row[8]),
    standard:String(row[7]) === 'Catatan pengguna' ? null : Number(row[9]),
    note:String(row[7]) === 'Catatan pengguna' ? String(row[12] || '') : '', action:String(row[10] || ''),
    actionAt:row[11] ? normaliseDateTime_(row[11]) : '', status:String(row[13] || 'Belum diambil tindakan'),
  }));
}

function validateRecord_(record) {
  if (!record || typeof record !== 'object') throw new Error('Rekod pemeriksaan tidak sah.');
  const checked = {
    id:safeText_(record.id, 80), checkKey:safeText_(record.checkKey, 80), savedAt:safeText_(record.savedAt, 40),
    date:safeText_(record.date, 10), bag:safeText_(record.bag, 10), shift:safeText_(record.shift, 10),
    ppp:safeText_(record.ppp, 100), notes:safeText_(record.notes || '', 1000), quantities:record.quantities,
  };
  if (!checked.id || !checked.checkKey || !checked.ppp) throw new Error('ID, kunci pemeriksaan dan nama PPP diperlukan.');
  if (!VALID_BAGS.includes(checked.bag)) throw new Error('Beg PHC tidak sah.');
  if (!VALID_SHIFTS.includes(checked.shift)) throw new Error('Shift tidak sah.');
  if (Number.isNaN(new Date(checked.savedAt).getTime())) throw new Error('Masa simpan tidak sah.');
  const expectedKey = `${checked.date}|${checked.bag}|${checked.shift}`;
  if (checked.checkKey !== expectedKey) throw new Error('Kunci pemeriksaan tidak sepadan.');
  parseIsoDate_(checked.date);
  if (!checked.quantities || typeof checked.quantities !== 'object') throw new Error('Data kuantiti tidak lengkap.');
  return checked;
}

function loadMaster_(spreadsheet, bag) {
  const rows = dataRows_(requiredSheet_(spreadsheet, SHEETS.master), 9).filter(row => String(row[6]) === 'AKTIF');
  const map = {};
  rows.filter(row => String(row[1]) === 'Kedua-dua' || String(row[1]) === bag).forEach(row => {
    map[`${row[2]}|${row[4]}`] = {categoryId:String(row[2]), categoryName:String(row[3]), name:String(row[4]), standard:Number(row[5])};
  });
  return map;
}

function flattenItems_(record, master) {
  const result = []; const seen = new Set();
  Object.keys(record.quantities).forEach(categoryId => {
    const group = record.quantities[categoryId];
    if (!group || !Array.isArray(group.items)) throw new Error(`Kategori ${categoryId} tidak lengkap.`);
    group.items.forEach(item => {
      const name = safeText_(item.name, 160); const key = `${categoryId}|${name}`; const source = master[key];
      if (!source) throw new Error(`Item tidak sah: ${name}.`);
      if (seen.has(key)) throw new Error(`Item berulang: ${name}.`); seen.add(key);
      const standard = Number(item.standard); const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 0 || qty > source.standard) throw new Error(`Kuantiti ${name} mesti antara 0 hingga ${source.standard}.`);
      if (standard !== source.standard) throw new Error(`Kuantiti standard ${name} tidak sepadan dengan master.`);
      result.push({...source, qty});
    });
  });
  if (seen.size !== Object.keys(master).length) throw new Error('Checklist tidak lengkap atau tidak sepadan dengan master item.');
  return result;
}

function setupSpreadsheetId(spreadsheetId) {
  const file = SpreadsheetApp.openById(String(spreadsheetId));
  [SHEETS.inspections,SHEETS.checks,SHEETS.findings,SHEETS.master].forEach(name => requiredSheet_(file,name));
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', file.getId());
  return `Google Sheet disambungkan: ${file.getName()}`;
}

/** Jalankan sekali selepas memasang versi 2.4.0. */
function migrateProductionData() {
  const spreadsheet = getSpreadsheet_();
  spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
  const inspectionSheet = requiredSheet_(spreadsheet, SHEETS.inspections);
  const checkSheet = requiredSheet_(spreadsheet, SHEETS.checks);
  const findingSheet = requiredSheet_(spreadsheet, SHEETS.findings);
  const inspections = dataRows_(inspectionSheet, 15).filter(row => row[0] && row[1]);

  const latestByKey = {};
  inspections.forEach(row => {
    const key = String(row[1]);
    if (!latestByKey[key] || normaliseDate_(row[2]).getTime() > normaliseDate_(latestByKey[key][2]).getTime()) latestByKey[key] = row;
  });
  const keptInspections = Object.values(latestByKey).map(row => {
    const copy = row.slice();
    const dateKey = String(copy[1]).slice(0, 10);
    const parts = dateKey.split('-').map(Number);
    copy[3] = parseIsoDate_(dateKey);
    copy[4] = MONTHS[parts[1] - 1]; copy[5] = parts[1]; copy[6] = parts[0];
    return copy;
  }).sort((a,b) => normaliseDate_(a[2]) - normaliseDate_(b[2]));
  const keptIds = new Set(keptInspections.map(row => String(row[0])));
  const inspectionById = {};
  keptInspections.forEach(row => { inspectionById[String(row[0])] = row; });
  const keptChecks = dataRows_(checkSheet, 18).filter(row => keptIds.has(String(row[0]))).map(row => {
    const copy = row.slice(); const inspection = inspectionById[String(copy[0])];
    copy[3] = inspection[3]; copy[4] = inspection[4]; copy[5] = inspection[5]; copy[6] = inspection[6];
    return copy;
  });

  const oldFindings = dataRows_(findingSheet, Math.max(14, findingSheet.getLastColumn()));
  const oldActionById = {};
  oldFindings.forEach(row => {
    if (row[0] && (row[10] || row[13])) oldActionById[String(row[0])] = {action:row[10], date:row[11], status:row[13]};
  });
  const checksByInspection = {};
  keptChecks.forEach(row => {
    const id = String(row[0]);
    if (!checksByInspection[id]) checksByInspection[id] = [];
    checksByInspection[id].push(row);
  });
  const rebuiltFindings = [];
  keptInspections.forEach(inspection => {
    const id = String(inspection[0]);
    let index = 0;
    (checksByInspection[id] || []).filter(row => Number(row[14]) < Number(row[13])).forEach(row => {
      const findingId = `${id}-F${String(++index).padStart(3, '0')}`;
      const prior = oldActionById[findingId] || {};
      rebuiltFindings.push([
        findingId, id, inspection[3], inspection[4], inspection[5], inspection[6],
        `${inspection[7]} / ${inspection[8]}`, row[12], row[14], row[13],
        prior.action || '', prior.date || '', '', prior.status || 'Belum diambil tindakan',
      ]);
    });
    if (String(inspection[12] || '').trim()) {
      const findingId = `${id}-NOTE`;
      const prior = oldActionById[findingId] || {};
      rebuiltFindings.push([
        findingId, id, inspection[3], inspection[4], inspection[5], inspection[6],
        `${inspection[7]} / ${inspection[8]}`, 'Catatan pengguna', '', '',
        prior.action || '', prior.date || '', String(inspection[12]).trim(), prior.status || 'Belum diambil tindakan',
      ]);
    }
  });

  rewriteData_(inspectionSheet, 15, keptInspections);
  rewriteData_(checkSheet, 18, keptChecks);
  rewriteData_(findingSheet, 14, rebuiltFindings);
  applyProductionFormatting_(spreadsheet);
  updateMonthlyReport_(spreadsheet);
  SpreadsheetApp.flush();
  return `Migrasi selesai: ${keptInspections.length} pemeriksaan unik, ${rebuiltFindings.length} penemuan.`;
}

function applyProductionFormatting_(spreadsheet) {
  spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
  const inspectionSheet = requiredSheet_(spreadsheet, SHEETS.inspections);
  const checkSheet = requiredSheet_(spreadsheet, SHEETS.checks);
  const findingSheet = requiredSheet_(spreadsheet, SHEETS.findings);
  findingSheet.getRange(1,14).setValue('Status');
  inspectionSheet.getRange('C:C').setNumberFormat('yyyy-mm-dd HH:mm:ss');
  inspectionSheet.getRange('D:D').setNumberFormat('yyyy-mm-dd');
  checkSheet.getRange('C:C').setNumberFormat('yyyy-mm-dd HH:mm:ss');
  checkSheet.getRange('D:D').setNumberFormat('yyyy-mm-dd');
  findingSheet.getRange('C:C').setNumberFormat('yyyy-mm-dd');
  findingSheet.getRange('L:L').setNumberFormat('yyyy-mm-dd HH:mm');
}

function updateMonthlyReport_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('LAPORAN BULANAN');
  if (!sheet) return;
  sheet.getRange('C10').setFormula('=IFERROR(COUNTUNIQUE(FILTER(PEMERIKSAAN!$B$2:$B$4999,PEMERIKSAAN!$E$2:$E$4999=$B$3,PEMERIKSAAN!$G$2:$G$4999=$D$3,PEMERIKSAAN!$H$2:$H$4999=$A10)),0)');
  sheet.getRange('C11').setFormula('=IFERROR(COUNTUNIQUE(FILTER(PEMERIKSAAN!$B$2:$B$4999,PEMERIKSAAN!$E$2:$E$4999=$B$3,PEMERIKSAAN!$G$2:$G$4999=$D$3,PEMERIKSAAN!$H$2:$H$4999=$A11)),0)');
  sheet.getRange('F15').setValue('Status');
  sheet.getRange('A16').setFormula('=IFERROR(FILTER({PENEMUAN!C2:C9999,PENEMUAN!G2:G9999,IF(PENEMUAN!H2:H9999="Catatan pengguna",PENEMUAN!M2:M9999,PENEMUAN!H2:H9999&" ("&PENEMUAN!I2:I9999&"/"&PENEMUAN!J2:J9999&")"),PENEMUAN!K2:K9999,PENEMUAN!L2:L9999,PENEMUAN!N2:N9999},PENEMUAN!D2:D9999=$B$3,PENEMUAN!F2:F9999=$D$3),"Tiada penemuan")');
  sheet.getRange('H10').setFormula('=COUNTIFS(PENEMUAN!$D$2:$D$9999,$B$3,PENEMUAN!$F$2:$F$9999,$D$3)');
  sheet.getRange('H11').setFormula('=COUNTIFS(PENEMUAN!$D$2:$D$9999,$B$3,PENEMUAN!$F$2:$F$9999,$D$3,PENEMUAN!$N$2:$N$9999,"Belum diambil tindakan")');
  sheet.getRange('F15').setBackground('#071d36').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange('F16:F200').setWrap(true).setVerticalAlignment('middle');
  sheet.setColumnWidth(6, 150);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('SPREADSHEET_ID belum ditetapkan.');
}
function requiredSheet_(spreadsheet, name) { const sheet=spreadsheet.getSheetByName(name); if(!sheet) throw new Error(`Tab ${name} tidak ditemui.`); return sheet; }
function dataRows_(sheet, columns) { const last=sheet.getLastRow(); return last < 2 ? [] : sheet.getRange(2,1,last-1,columns).getValues(); }
function appendRows_(sheet, rows) { if(rows.length) sheet.getRange(sheet.getLastRow()+1,1,rows.length,rows[0].length).setValues(rows); }
function idExists_(sheet, id) { if(sheet.getLastRow()<2) return false; return !!sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).findNext(); }
function findRowByValue_(sheet, column, value) { if(sheet.getLastRow()<2) return 0; const match=sheet.getRange(2,column,sheet.getLastRow()-1,1).createTextFinder(String(value)).matchEntireCell(true).findNext(); return match ? match.getRow() : 0; }
function deleteRowsByValue_(sheet, column, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const values = sheet.getRange(2, column, lastRow - 1, 1).getDisplayValues();
  const rows = values.map((row, index) => String(row[0]) === String(value) ? index + 2 : 0).filter(Boolean);
  if (!rows.length) return;
  const groups = [];
  rows.forEach(row => {
    const current = groups[groups.length - 1];
    if (current && row === current.start + current.count) current.count += 1;
    else groups.push({start:row, count:1});
  });
  groups.reverse().forEach(group => sheet.deleteRows(group.start, group.count));
}
function rewriteData_(sheet, columns, rows) { const existing=Math.max(0,sheet.getLastRow()-1); if(existing) sheet.getRange(2,1,existing,Math.max(columns,sheet.getLastColumn())).clearContent(); if(rows.length) sheet.getRange(2,1,rows.length,columns).setValues(rows.map(row=>row.slice(0,columns))); }
function safeText_(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max); }
function parseIsoDate_(text) { if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Tarikh tidak sah.'); const parts=text.split('-').map(Number); const date=new Date(`${text}T12:00:00+08:00`); if(Number.isNaN(date.getTime())||Number(Utilities.formatDate(date,TIME_ZONE,'yyyy'))!==parts[0]||Number(Utilities.formatDate(date,TIME_ZONE,'MM'))!==parts[1]||Number(Utilities.formatDate(date,TIME_ZONE,'dd'))!==parts[2]) throw new Error('Tarikh tidak sah.'); return date; }
function normaliseDate_(value) { return value instanceof Date ? value : new Date(value); }
function normaliseDateTime_(value) { return normaliseDate_(value).toISOString(); }
function formatIsoDate_(value) { return Utilities.formatDate(normaliseDate_(value), TIME_ZONE, 'yyyy-MM-dd'); }
function json_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }
