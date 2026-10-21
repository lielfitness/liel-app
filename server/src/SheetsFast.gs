/**
 * מסלול מהיר לשמירה: Sheets API ישיר (שירות מתקדם "Sheets") במקום SpreadsheetApp.
 *  - קריאה אחת: כותרות העמודות הנוספות + השורה (ועד 5 שורות לפניה) עם ערך, פורמט ותצוגה – בלי openById.
 *  - כתיבה אחת: כל התאים שהשתנו בבקשה אחת (batchUpdate), בלי flush.
 * אם השירות לא זמין / נכשל – חוזרים אוטומטית למסלול הרגיל (locateLead_), כך ששום דבר לא נשבר.
 */

const FAST_LAST_COL_ = 52; // AZ

function fastAvailable_() {
  return typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets;
}

/** מאתר את הליד בקריאה אחת. מחזיר null אם אי אפשר (ואז משתמשים במסלול הרגיל). */
function fastLocate_(cfg, row, id) {
  if (!fastAvailable_()) return null;
  row = Number(row);
  if (!(row >= 2)) return null;
  const from = Math.max(2, row - 5);
  const t = "'" + LEADS_TAB_ + "'";
  let res;
  try {
    res = Sheets.Spreadsheets.get(cfg.leadsSheetId, {
      ranges: [t + '!AG1:AZ1', t + '!A' + from + ':AZ' + row],
      fields: 'sheets(properties(sheetId),data(rowData(values(userEnteredValue,userEnteredFormat/numberFormat,formattedValue))))',
    });
  } catch (e) {
    console.warn('Sheets API לא זמין, עובר למסלול הרגיל: ' + (e.message || e));
    return null;
  }
  const sheet = res.sheets && res.sheets[0];
  if (!sheet || !sheet.data || sheet.data.length < 2) return null;

  const hdrCells = (((sheet.data[0].rowData || [])[0]) || {}).values || [];
  const hdr = hdrCells.map(function (c) { return normHeader_(c.formattedValue || ''); });
  const at = function (name) { const i = hdr.indexOf(name); return i < 0 ? 0 : LAST_BASE_COL_ + 1 + i; };
  const ex = { updated: at(UPDATED_HEADER_), shaiNotes: at(SHAI_NOTES_HEADER_) };

  const rd = sheet.data[1].rowData || [];
  let prev = null, lead = null, prevForRow = null, cells = null, disp = null;
  for (let r = from; r <= row; r++) {
    const vals = ((rd[r - from] || {}).values) || [];
    const d = [];
    for (let c = 0; c < FAST_LAST_COL_; c++) d.push(vals[c] && vals[c].formattedValue != null ? String(vals[c].formattedValue) : '');
    if (r === row) { prevForRow = prev; cells = vals; disp = d; }
    lead = buildLead_(r, d, d, prev, ex.updated, ex.shaiNotes);
    if (lead && lead._entryDate) prev = lead._entryDate;
  }
  if (!lead || lead.row !== row || lead.id !== id) return null;
  lead._raw = { v: disp.slice(), d: disp.slice(), prev: prevForRow, ex: ex };
  return { fast: true, cfg: cfg, sheetId: sheet.properties.sheetId, lead: lead, ex: ex, upCol: ex.updated, cells: cells, pending: {} };
}

/** תאריך/שעה בשעון ישראל → מספר סידורי של גוגל שיטס (ימים מ-30/12/1899). */
function sheetSerial_(y, m, d, h, mi) {
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5 + ((h || 0) * 60 + (mi || 0)) / 1440;
}

/** ערך + פורמט → תא ל-Sheets API. */
function fastCell_(value, format) {
  if (value === '' || value == null) return { cell: {}, fields: 'userEnteredValue' };
  const s = String(value);
  const withFmt = 'userEnteredValue,userEnteredFormat.numberFormat';
  let m;
  if (format === 'dd/MM/yyyy' && (m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) {
    return { cell: { userEnteredValue: { numberValue: sheetSerial_(+m[3], +m[2], +m[1]) },
      userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/MM/yyyy' } } }, fields: withFmt };
  }
  if (format === 'dd/MM/yyyy HH:mm' && (m = s.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/))) {
    return { cell: { userEnteredValue: { numberValue: sheetSerial_(+m[3], +m[2], +m[1], +m[4], +m[5]) },
      userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd/MM/yyyy HH:mm' } } }, fields: withFmt };
  }
  if (format === '@') {
    return { cell: { userEnteredValue: { stringValue: s }, userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: withFmt };
  }
  return { cell: { userEnteredValue: { stringValue: s } }, fields: 'userEnteredValue' };
}

/** מחזיר תא בדיוק כפי שהיה (ערך + פורמט) – לביטול. */
function fastRestoreCell_(uv, nf) {
  const cell = {};
  if (uv) cell.userEnteredValue = uv;
  if (nf) cell.userEnteredFormat = { numberFormat: nf };
  return { cell: cell, fields: 'userEnteredValue,userEnteredFormat.numberFormat' };
}

/** שולח את כל התאים שהשתנו בבקשה אחת. */
function commitFast_(loc) {
  if (!loc || !loc.fast) return;
  const cols = Object.keys(loc.pending);
  if (!cols.length) return;
  const row = loc.lead.row;
  const requests = cols.map(function (c) {
    const p = loc.pending[c];
    return { updateCells: {
      range: { sheetId: loc.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: Number(c) - 1, endColumnIndex: Number(c) },
      rows: [{ values: [p.cell] }], fields: p.fields,
    } };
  });
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, loc.cfg.leadsSheetId);
  loc.pending = {};
}

/** איתור לשמירה: קודם המסלול המהיר, ואם לא – הרגיל. */
function locateForWrite_(cfg, row, id) {
  return fastLocate_(cfg, row, id) || locateLead_(cfg, row, id);
}

// ---------- מטמון: עדכון השורה שהשתנתה במקום מחיקה ----------
let CACHE_PATCH_ = null;   // ליד אחד שהשתנה → מעדכנים רק אותו במטמון

function patchLeadsCache_(lead) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(LEADS_CACHE_KEY_);
  if (!hit) return;
  try {
    const data = JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(hit), 'application/x-gzip')).getDataAsString());
    const i = data.leads.findIndex(function (l) { return l.id === lead.id; });
    if (i < 0) { cache.remove(LEADS_CACHE_KEY_); return; }
    data.leads[i] = lead;
    const z = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(data), 'application/json')).getBytes());
    if (z.length < 95000) cache.put(LEADS_CACHE_KEY_, z, LEADS_CACHE_SEC_); else cache.remove(LEADS_CACHE_KEY_);
  } catch (e) {
    cache.remove(LEADS_CACHE_KEY_);
  }
}

// ---------- מטמון לגוסטינג ----------
const GHOST_CACHE_KEY_ = 'ghost_v1';

function invalidateGhost_() {
  try { CacheService.getScriptCache().remove(GHOST_CACHE_KEY_); } catch (e) { /* */ }
}
