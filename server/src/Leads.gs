/**
 * מודול הלידים: קריאה, עדכון כרטיס, ניסיונות שיחה/WA, גוסטינג.
 * לשונית "לידים פעילים" – לא משנים סדר/שמות עמודות. העמודה "עודכן לאחרונה" נמצאת בסוף (אחרי AF)
 * ומאותרת לפי שם הכותרת, כך שאם היא חסרה הכל ממשיך לעבוד (פשוט בלי חותמת עדכון).
 */

const LEADS_TAB_ = 'לידים פעילים';
const GHOST_TAB_ = 'Ghosting';
const UPDATED_HEADER_ = 'עודכן לאחרונה';
const SHAI_NOTES_HEADER_ = 'הערות שי';

const COL_ = {
  entry: 1, name: 2, phone: 3, email: 4, ad: 5,
  callResult: 6, call1Date: 7, call1Time: 8, call2: 9, wa1: 10, call3: 11, wa2: 12, wa3: 13,
  status: 14, summary: 15, zoomResult: 16, notes: 17, zoomDate: 18, reward: 19,
  source: 20, age: 21, cert: 22, difficulty: 23, improve: 24, change: 25, insta: 26,
};
const CALL_COLS_ = [COL_.call1Date, COL_.call2, COL_.call3];
const WA_COLS_ = [COL_.wa1, COL_.wa2, COL_.wa3];
const LAST_BASE_COL_ = 32; // AF

const STATUSES_ = ['ליד חדש', 'ניסיון שיחה', 'שיחה בוצעה', 'זום נקבע', 'פגישה בוטלה', 'נסגר', 'לא מעוניין', 'לא רלוונטי', 'עתידי', 'Ghosting'];
const FINAL_STATUSES_ = ['נסגר', 'לא מעוניין', 'לא רלוונטי', 'Ghosting'];
// "לא טופלו": רק הסטטוסים האלה (וסטטוס ריק). כל השאר – לעולם לא.
const UNTREATED_STATUSES_ = ['ליד חדש', 'ניסיון שיחה', 'WA נשלח', 'שיחה בוצעה', 'פגישה בוטלה', 'עתידי', ''];

// כתיבים שונים שעלולים להופיע בגיליון → הסטטוס הקנוני
const STATUS_VARIANTS_ = {
  'ליד חדש': ['ליד חדש', 'חדש'],
  'ניסיון שיחה': ['ניסיון שיחה', 'נסיון שיחה', 'ניסיון התקשרות', 'נסיון התקשרות'],
  'WA נשלח': ['wa נשלח', 'נשלח wa', 'וואטסאפ נשלח', 'ווטסאפ נשלח', 'נשלח וואטסאפ', 'נשלח ווטסאפ'],
  'שיחה בוצעה': ['שיחה בוצעה', 'בוצעה שיחה', 'שיחה התבצעה'],
  'עתידי': ['עתידי', 'עתידית'],
  'פגישה בוטלה': ['פגישה בוטלה', 'פגישה מבוטלת', 'זום בוטל', 'זום מבוטל', 'בוטלה פגישה', 'בוטל זום'],
  'זום נקבע': ['זום נקבע', 'זום נקבעה', 'נקבע זום', 'נקבעה פגישה', 'פגישה נקבעה'],
  'נסגר': ['נסגר', 'נסגרה', 'ליד נסגר'],
  'לא מעוניין': ['לא מעוניין', 'לא מעוניינת', 'לא מעונין', 'לא מעונינת'],
  'לא רלוונטי': ['לא רלוונטי', 'לא רלוונטית', 'לא רלבנטי', 'לא רלבנטית'],
  'Ghosting': ['ghosting', 'ghost', 'גוסטינג', 'גווסטינג', 'גוסט'],
};

/** מנקה רווחים מיותרים, תווי כיווניות ופיסוק, ומחזיר את הסטטוס הקנוני (או את הטקסט המנוקה אם לא מוכר). */
function canonicalStatus_(s) {
  const n = String(s || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  if (!n) return '';
  const keys = Object.keys(STATUS_VARIANTS_);
  for (let i = 0; i < keys.length; i++) {
    if (STATUS_VARIANTS_[keys[i]].indexOf(n) >= 0) return keys[i];
  }
  return n;
}
const ZOOM_RESULTS_ = ['נסגר', 'לא נסגר', 'לא הגיע', 'ממתין'];
const UNTREATED_MS_ = 2 * DAY_MS_;

// השדות שהאפליקציה רשאית לכתוב בכרטיס (שאר העמודות לא נכתבות מהאפליקציה)
const EDITABLE_ = {
  status: COL_.status, summary: COL_.summary, zoomResult: COL_.zoomResult,
  notes: COL_.notes, callResult: COL_.callResult, zoomDate: COL_.zoomDate,
};

function leadsSheet_(cfg) {
  const sh = SpreadsheetApp.openById(cfg.leadsSheetId).getSheetByName(LEADS_TAB_);
  if (!sh) throw apiError_('CONFIG', 'לא נמצאה הלשונית ' + LEADS_TAB_);
  return sh;
}

function normHeader_(h) {
  return String(h || '').replace(/\s+/g, ' ').trim();
}

/** עמודות שנוספו בסוף (אחרי AF) – מאותרות לפי שם הכותרת. 0 = לא קיימת. */
function extraCols_(sh) {
  const lastCol = sh.getLastColumn();
  const cache = CacheService.getScriptCache();
  const ck = 'extraCols_' + lastCol;
  try { const hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (e) { /* */ }
  const res = extraColsRead_(sh, lastCol);
  try { cache.put(ck, JSON.stringify(res), 600); } catch (e) { /* */ }
  return res;
}

function extraColsRead_(sh, lastCol) {
  if (lastCol <= LAST_BASE_COL_) return { updated: 0, shaiNotes: 0 };
  const hdr = sh.getRange(1, LAST_BASE_COL_ + 1, 1, lastCol - LAST_BASE_COL_).getDisplayValues()[0].map(normHeader_);
  const at = function (name) { const i = hdr.indexOf(name); return i < 0 ? 0 : LAST_BASE_COL_ + 1 + i; };
  return { updated: at(UPDATED_HEADER_), shaiNotes: at(SHAI_NOTES_HEADER_) };
}

function updatedCol_(sh) {
  return extraCols_(sh).updated;
}

function digits_(s) {
  return String(s || '').replace(/\D/g, '');
}

/** 9 הספרות האחרונות – משווה 0501234567 / 972501234567 / 501234567 */
function phoneKey_(s) {
  const d = digits_(s);
  return d.length >= 9 ? d.slice(-9) : '';
}

function leadId_(entryDisp, phone, email, name) {
  const base = [String(entryDisp).trim(), phoneKey_(phone), String(email || '').trim().toLowerCase()];
  if (!base[1] && !base[2]) base.push(String(name || '').trim());
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base.join('|'), Utilities.Charset.UTF_8);
  return bytes.slice(0, 5).map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function isFinal_(status) {
  return FINAL_STATUSES_.indexOf(canonicalStatus_(status)) >= 0;
}

/** קורא את כל הלידים. מחזיר מערך אובייקטים (שורות ריקות מדולגות). */
function readLeads_(cfg) {
  const sh = leadsSheet_(cfg);
  const ex = extraCols_(sh);
  const upCol = ex.updated;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { sh: sh, upCol: upCol, ex: ex, leads: [] };
  const width = Math.max(LAST_BASE_COL_, upCol, ex.shaiNotes);
  const rng = sh.getRange(2, 1, lastRow - 1, width);
  const vals = rng.getValues();
  const disp = rng.getDisplayValues();
  const leads = [];
  let prevEntry = null;
  for (let i = 0; i < vals.length; i++) {
    const lead = buildLead_(i + 2, vals[i], disp[i], prevEntry, upCol, ex.shaiNotes);
    if (!lead) continue;
    if (lead._entryDate) prevEntry = lead._entryDate;
    leads.push(lead);
  }
  return { sh: sh, upCol: upCol, ex: ex, leads: leads };
}

function buildLead_(row, v, d, prevEntry, upCol, shaiCol) {
  const g = function (c) { return String(d[c - 1] == null ? '' : d[c - 1]).trim(); };
  if (!g(COL_.name) && !g(COL_.phone) && !g(COL_.email)) return null;
  const shaiNotes = shaiCol ? g(shaiCol) : '';

  const entry = parseSheetDate_(v[COL_.entry - 1], d[COL_.entry - 1], prevEntry, false);
  const ref = entry || prevEntry;
  const at = function (c) { return parseSheetDate_(v[c - 1], d[c - 1], ref, true); };
  const zoom = at(COL_.zoomDate);
  const updated = upCol ? parseUpdated_(d[upCol - 1]) : null;

  // "פעילות אחרונה" = עודכן לאחרונה, ואם אין – התאריך המאוחר מבין כניסה/ניסיונות/WA
  // תאריך בלי שעה נחשב כסוף אותו יום; תאריכים עתידיים (הקלדה שגויה) לא נחשבים
  let last = updated ? updated.getTime() : 0;
  [entry].concat(CALL_COLS_.concat(WA_COLS_).map(at)).forEach(function (x) {
    const t = x ? x.getTime() + DAY_MS_ - 1 : 0;
    if (t > last && x.getTime() <= Date.now()) last = t;
  });
  const status = g(COL_.status);
  const calls = CALL_COLS_.filter(function (c) { return g(c); }).length;
  const was = WA_COLS_.filter(function (c) { return g(c); }).length;

  return {
    row: row,
    id: leadId_(g(COL_.entry), g(COL_.phone), g(COL_.email), g(COL_.name)),
    entry: isoDate_(entry), entryRaw: g(COL_.entry),
    name: g(COL_.name), phone: g(COL_.phone), email: g(COL_.email), ad: g(COL_.ad),
    callResult: g(COL_.callResult),
    call1Date: g(COL_.call1Date), call1Time: g(COL_.call1Time), call2: g(COL_.call2), call3: g(COL_.call3),
    wa1: g(COL_.wa1), wa2: g(COL_.wa2), wa3: g(COL_.wa3),
    calls: calls, was: was,
    status: status, statusKey: canonicalStatus_(status), shaiNotes: shaiNotes, summary: g(COL_.summary), zoomResult: g(COL_.zoomResult), notes: g(COL_.notes),
    zoomDate: isoDate_(zoom), zoomDateRaw: g(COL_.zoomDate), reward: g(COL_.reward),
    source: g(COL_.source), age: g(COL_.age), cert: g(COL_.cert), difficulty: g(COL_.difficulty),
    improve: g(COL_.improve), change: g(COL_.change), insta: g(COL_.insta),
    updatedAt: updated ? updated.getTime() : 0,
    lastActivity: last,
    untreated: UNTREATED_STATUSES_.indexOf(canonicalStatus_(status)) >= 0 && (!last || Date.now() - last > UNTREATED_MS_),
    _entryDate: entry,
  };
}

/** "עודכן לאחרונה" נקרא מהטקסט המוצג (שעון ישראל), לא מה-Date של הגיליון (שעון לוס אנג'לס). */
function parseUpdated_(disp) {
  const m = String(disp || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
  return isNaN(d) ? null : d;
}

function publicLead_(l) {
  const o = {};
  Object.keys(l).forEach(function (k) { if (k[0] !== '_') o[k] = l[k]; });
  return o;
}

// ---------- מדידת שלבים (נשלחת לאפליקציה רק במצב debug) ----------
let PHASES_ = null, PHASE_T_ = 0;
function phase_(name) {
  if (!PHASES_) { PHASES_ = []; PHASE_T_ = Date.now(); }
  const now = Date.now();
  PHASES_.push(name + ' ' + (now - PHASE_T_));
  PHASE_T_ = now;
}

// ---------- פעולות ----------

function actionListLeads_(req, ctx) {
  if (req.fresh) invalidateLeads_();
  const c = cachedLeads_(ctx.cfg);
  repairZoomLinks_(c.leads);
  const fz = futureZoomByLead_();
  c.leads.forEach(function (x) { x.zoomEvent = fz[x.id] || null; });
  return {
    leads: c.leads,
    statuses: allowedValues_(STATUSES_, ctx.role),
    zoomResults: allowedValues_(ZOOM_RESULTS_, ctx.role),
    sources: leadSources_(c.leads),
    waitingFilter: ctx.role === 'admin',   // סינון "ממתינים" – רק לליאל
    hasUpdatedCol: c.hasUpdatedCol,
    hasShaiNotesCol: c.hasShaiNotesCol,
  };
}

// שי (leads) לא יכולה לסמן "נסגר" – לא בסטטוס (N) ולא בתוצאת זום (P). נאכף כאן בשרת.
const ADMIN_ONLY_VALUES_ = ['נסגר'];
function allowedValues_(list, role) {
  return role === 'admin' ? list : list.filter(function (v) { return ADMIN_ONLY_VALUES_.indexOf(v) < 0; });
}

/** מאתר את השורה של הליד: קודם לפי מספר השורה, ואם השורה זזה – לפי המזהה. */
/** קורא רק את השורה (ועד 5 שורות לפניה, כדי לפענח תאריכים כמו בקריאה המלאה). */
function readLeadAt_(sh, ex, row) {
  row = Number(row);
  if (!(row >= 2)) return null;
  const from = Math.max(2, row - 5);
  const width = Math.max(LAST_BASE_COL_, ex.updated, ex.shaiNotes);
  let vals, disp;
  try {
    const rng = sh.getRange(from, 1, row - from + 1, width);
    vals = rng.getValues(); disp = rng.getDisplayValues();
  } catch (e) { return null; }   // שורה מחוץ לגיליון
  let prev = null, lead = null, prevForRow = null;
  for (let i = 0; i < vals.length; i++) {
    if (i === vals.length - 1) prevForRow = prev;
    lead = buildLead_(from + i, vals[i], disp[i], prev, ex.updated, ex.shaiNotes);
    if (lead && lead._entryDate) prev = lead._entryDate;
  }
  if (!lead || lead.row !== row) return null;
  // לבנייה מחדש אחרי כתיבה, בלי לקרוא שוב מהגיליון
  lead._raw = { v: vals[vals.length - 1].slice(), d: disp[disp.length - 1].slice(), prev: prevForRow, ex: ex };
  return lead;
}

/** כותב תא, וזוכר מה נכתב כדי לבנות את הליד מחדש בזיכרון. display = הטקסט שיוצג בגיליון. */
function put_(loc, col, value, format) {
  if (loc.undo && col !== loc.upCol && !loc.undo[col]) {
    if (loc.fast) {
      const fc = loc.cells[col - 1] || {};
      loc.undo[col] = { col: col, uv: fc.userEnteredValue || null, nf: (fc.userEnteredFormat && fc.userEnteredFormat.numberFormat) || null,
        bd: fc.formattedValue != null ? String(fc.formattedValue) : '' };
    } else {
      const snap = rowSnapshot_(loc);
      loc.undo[col] = { col: col, bv: serializeCell_(snap.v[col - 1]), bf: snap.f[col - 1] || '', bd: String(snap.d[col - 1] == null ? '' : snap.d[col - 1]) };
    }
  }
  // טקסט חופשי שנראה כמו מספר/תאריך – נשמר כטקסט (שהגיליון לא יהפוך אותו לתאריך)
  if (!format && typeof value === 'string' && /^[\d\s.\/:\-]+$/.test(value) && /\d/.test(value)) format = '@';
  if (loc.fast) {
    loc.pending[col] = fastCell_(value, format);
  } else {
    const c = loc.sh.getRange(loc.lead.row, col);
    if (format) c.setNumberFormat(format);
    if (value === '' || value == null) c.clearContent(); else c.setValue(value);
  }
  if (loc.lead._raw) { loc.lead._raw.v[col - 1] = value == null ? '' : value; loc.lead._raw.d[col - 1] = value == null ? '' : String(value); }
  if (loc.undo && loc.undo[col]) loc.undo[col].ad = value == null ? '' : String(value);
}

/** מצב השורה לפני השינוי (ערכים, תצוגה, פורמטים) – נקרא פעם אחת לכל שמירה. */
function rowSnapshot_(loc) {
  if (loc.snap) return loc.snap;
  const width = Math.max(LAST_BASE_COL_, loc.ex.updated, loc.ex.shaiNotes);
  const rng = loc.sh.getRange(loc.lead.row, 1, 1, width);
  const f = rng.getNumberFormats()[0];
  if (loc.lead._raw) {
    loc.snap = { v: loc.lead._raw.v.slice(), d: loc.lead._raw.d.slice(), f: f };
  } else {
    loc.snap = { v: rng.getValues()[0], d: rng.getDisplayValues()[0], f: f };
  }
  return loc.snap;
}

function serializeCell_(v) {
  return v instanceof Date ? { d: v.toISOString() } : (v == null ? '' : v);
}

/** הליד אחרי הכתיבה: נבנה מהנתונים שנקראו + מה שנכתב (בלי קריאה נוספת). */
function leadAfterWrite_(cfg, loc) {
  const raw = loc.lead._raw;
  if (raw) {
    const l = buildLead_(loc.lead.row, raw.v, raw.d, raw.prev, raw.ex.updated, raw.ex.shaiNotes);
    if (l) return publicLead_(l);
  }
  return rereadLead_(cfg, loc.lead.id, loc.lead.row);
}

function locateLead_(cfg, row, id) {
  const sh = leadsSheet_(cfg);
  const ex = extraCols_(sh);
  const quick = readLeadAt_(sh, ex, row);
  if (quick && quick.id === id) return { sh: sh, upCol: ex.updated, ex: ex, lead: quick };
  const r = readLeads_(cfg);
  let lead = r.leads.filter(function (l) { return l.row === Number(row); })[0];
  if (!lead || lead.id !== id) {
    lead = r.leads.filter(function (l) { return l.id === id; })[0];
  }
  if (!lead) throw apiError_('STALE', 'הליד לא נמצא – אולי השורה השתנתה. רענני את הרשימה.');
  return { sh: r.sh, upCol: r.upCol, ex: r.ex, lead: lead };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw apiError_('BUSY', 'השרת עסוק, נסי שוב בעוד רגע');
  CACHE_PATCH_ = null;
  let ok = false;
  try {
    const out = fn();
    SpreadsheetApp.flush();
    if (PHASES_) phase_('flush');
    ok = true;
    return out;
  } finally {
    if (ok && CACHE_PATCH_ === 'skip') { /* לא השתנה כלום בגיליון */ }
    else if (ok && CACHE_PATCH_) patchLeadsCache_(CACHE_PATCH_); else invalidateLeads_();
    CACHE_PATCH_ = null;
    if (PHASES_) phase_('cache');
    lock.releaseLock();
  }
}

// אזור הזמן של גיליון הלידים הוא America/Los_Angeles, לכן לא כותבים אובייקט Date
// (הוא היה מוצג יום/שעות אחרים). כותבים טקסט בשעון ישראל, והגיליון (he_IL) מפרש אותו כתאריך.
function setDateCell_(sh, row, col, date) {
  const c = sh.getRange(row, col);
  if (!date) { c.clearContent(); return; }
  c.setNumberFormat('dd/MM/yyyy').setValue(Utilities.formatDate(date, TZ_, 'dd/MM/yyyy'));
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy HH:mm');
}

function touch_(sh, row, upCol, loc) {
  if (!upCol) return;
  if (loc) { put_(loc, upCol, nowStamp_(), 'dd/MM/yyyy HH:mm'); return; }
  sh.getRange(row, upCol).setNumberFormat('dd/MM/yyyy HH:mm').setValue(nowStamp_());
}

function rereadLead_(cfg, id, row) {
  const sh = leadsSheet_(cfg);
  const quick = row ? readLeadAt_(sh, extraCols_(sh), row) : null;
  if (quick && quick.id === id) return publicLead_(quick);
  const r = readLeads_(cfg);
  const l = r.leads.filter(function (x) { return x.id === id; })[0];
  return l ? publicLead_(l) : null;
}

// ---------- מטמון בשרת (CacheService) לרשימת הלידים ----------
// נשמר ל-45 שניות, ומתרוקן בכל כתיבה מהאפליקציה ובכל עריכה ידנית בגיליון.
const LEADS_CACHE_KEY_ = 'leads_v4';
const LEADS_CACHE_SEC_ = 120;

function cachedLeads_(cfg) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(LEADS_CACHE_KEY_);
  if (hit) {
    try {
      return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(hit), 'application/x-gzip')).getDataAsString());
    } catch (e) { /* נקרא מחדש */ }
  }
  const r = readLeads_(cfg);
  const data = { leads: r.leads.map(publicLead_), hasUpdatedCol: !!r.upCol, hasShaiNotesCol: !!r.ex.shaiNotes };
  try {
    const z = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(data), 'application/json')).getBytes());
    if (z.length < 95000) cache.put(LEADS_CACHE_KEY_, z, LEADS_CACHE_SEC_);
  } catch (e) { /* בלי מטמון */ }
  return data;
}

function invalidateLeads_() {
  try { CacheService.getScriptCache().remove(LEADS_CACHE_KEY_); } catch (e) { /* */ }
}

function actionUpdateLead_(req, ctx) {
  const fields = req.fields || {};
  let ghost = null, reward = null;
  let result = null;
  phase_('start');
  withLock_(function () {
    phase_('lock');
    const loc = locateForWrite_(ctx.cfg, req.row, req.id);
    loc.undo = {};
    phase_(loc.fast ? 'read row (api)' : 'read row');
    const lead = loc.lead, row = lead.row;
    let changed = false, zoomMonths = null;

    Object.keys(fields).forEach(function (k) {
      const col = k === 'shaiNotes' ? loc.ex.shaiNotes : EDITABLE_[k];
      if (k === 'shaiNotes' && !col) throw apiError_('CONFIG', 'עמודת "הערות שי" לא נמצאה בגיליון');
      if (!col) return;
      let v = fields[k] == null ? '' : String(fields[k]).trim();
      if (k === 'status' && v && STATUSES_.indexOf(v) < 0) throw apiError_('BAD_REQUEST', 'סטטוס לא מוכר');
      if ((k === 'status' || k === 'zoomResult') && v && v !== String(lead[k] || '').trim() &&
          allowedValues_([v], ctx.role).length === 0) {
        throw apiError_('FORBIDDEN', 'אין הרשאה לסמן "' + v + '" – רק ליאל יכול');
      }
      if (k === 'zoomResult' && v && ZOOM_RESULTS_.indexOf(v) < 0) throw apiError_('BAD_REQUEST', 'תוצאת זום לא מוכרת');
      if (k === 'zoomDate') {
        const d = v ? parseIso_(v) : null;
        if (v && !d) throw apiError_('BAD_REQUEST', 'תאריך זום לא תקין');
        if (isoDate_(d) === lead.zoomDate) return;
        put_(loc, col, d ? Utilities.formatDate(d, TZ_, 'dd/MM/yyyy') : '', 'dd/MM/yyyy');
      } else {
        if (v === lead[k]) return;
        put_(loc, col, v, k === 'shaiNotes' ? '@' : null);
      }
      changed = true;
    });

    if (changed) touch_(null, row, loc.upCol, loc);
    commitFast_(loc);
    phase_('write');

    // R או P השתנו → חישוב מחדש של S (רק בחודשים פתוחים)
    const zoomChanged = (fields.zoomDate != null && String(fields.zoomDate).trim() !== lead.zoomDate) ||
      (fields.zoomResult != null && String(fields.zoomResult).trim() !== lead.zoomResult);
    if (zoomChanged) {
      SpreadsheetApp.flush();
      const newZoom = fields.zoomDate != null ? String(fields.zoomDate).trim() : lead.zoomDate;
      const oldMonth = lead.zoomDate.slice(0, 7), newMonth = newZoom.slice(0, 7);
      const r2 = readLeads_(ctx.cfg);
      const res = syncRewards_(r2.sh, r2.leads, [oldMonth, newMonth], false);
      // הזום נמחק: הליד כבר לא בשום חודש – מרוקנים את S אם החודש הישן פתוח
      if (!newZoom && oldMonth && !isLockedMonth_(oldMonth) && String(lead.reward || '').trim()) {
        r2.sh.getRange(row, COL_.reward).setValue('');
      }
      reward = { changes: res.changes.length, warning: lockedWarning_(res.locked) };
      zoomMonths = [oldMonth, newMonth];
      lead._raw = null;   // S אולי השתנה – הליד ייקרא מחדש מהגיליון
      phase_('reward sync');
    }

    const newStatus = fields.status != null ? String(fields.status).trim() : lead.status;
    if (newStatus === 'Ghosting' && lead.status !== 'Ghosting') {
      SpreadsheetApp.flush();
      const merged = Object.assign({}, lead, {
        summary: fields.summary != null ? fields.summary : lead.summary,
        shaiNotes: fields.shaiNotes != null ? fields.shaiNotes : lead.shaiNotes,
      });
      ghost = copyToGhosting_(ctx.cfg, merged);
      phase_('ghosting');
    }
    recordUndo_(ctx.email, loc, describeFields_(fields), { zoomMonths: zoomMonths, ghost: ghost && ghost.copied ? ghost : null });
    result = loc;
    result.out = leadAfterWrite_(ctx.cfg, loc);
    if (!zoomMonths && result.out) CACHE_PATCH_ = result.out;   // רק הליד הזה השתנה
  });
  const out = { lead: result.out, ghost: ghost, reward: reward, undoCount: result.undoCount != null ? result.undoCount : undoCount_(ctx.email), redoCount: 0 };
  phase_('build');
  if (req.debug) out.phases = PHASES_;
  return out;
}

/** "2026-10-21T14:30" → Date */
function parseLocalDateTime_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/**
 * ניסיון שיחה: שי בוחרת מספר ניסיון (1/2/3) ותאריך+שעה.
 *   ניסיון 1 → G = תאריך (dd/MM/yyyy), H = שעה (HH:mm), F = תוצאת השיחה (אם הוקלדה)
 *   ניסיון 2/3 → I / K = "dd/MM HH:mm" (תא אחד)
 * WA: העמודה הפנויה הבאה (J → L → M) בתאריך היום.
 * לא משנה סטטוס. תא מלא נדרס רק עם overwrite.
 */
function actionMarkAttempt_(req, ctx) {
  const kind = req.kind === 'wa' ? 'wa' : 'call';
  let result = null;
  phase_('start');
  withLock_(function () {
    phase_('lock');
    const loc = locateForWrite_(ctx.cfg, req.row, req.id);
    loc.undo = {};
    phase_(loc.fast ? 'read row (api)' : 'read row');
    const lead = loc.lead, row = lead.row;
    // מה שכבר כתוב בשורה – מהקריאה שכבר נעשתה (בלי קריאה נוספת)
    const byCol = {};
    byCol[COL_.call1Date] = lead.call1Date; byCol[COL_.call2] = lead.call2; byCol[COL_.call3] = lead.call3;
    byCol[COL_.wa1] = lead.wa1; byCol[COL_.wa2] = lead.wa2; byCol[COL_.wa3] = lead.wa3;
    const disp = []; Object.keys(byCol).forEach(function (c) { disp[c - 1] = byCol[c]; });
    const filled = function (c) { return !!String(byCol[c] || '').trim(); };
    const today = Utilities.formatDate(todayMidnight_(), TZ_, 'dd/MM/yyyy');

    if (kind === 'wa') {
      let col;
      if (req.attempt) {
        const w = Number(req.attempt);
        if ([1, 2, 3].indexOf(w) < 0) throw apiError_('BAD_REQUEST', 'מספר WA לא תקין');
        col = WA_COLS_[w - 1];
        if (req.clear) {
          put_(loc, col, '');
        } else {
          if (filled(col) && !req.overwrite) throw apiError_('FILLED', 'WA ' + w + ' כבר מסומן');
          put_(loc, col, today, 'dd/MM/yyyy');
        }
      } else {
        col = WA_COLS_.filter(function (c) { return !filled(c); })[0];
        if (!col) throw apiError_('FULL', 'כבר נשלחו 3 הודעות WA');
        put_(loc, col, today, 'dd/MM/yyyy');
      }
    } else if (req.clear) {
      // ביטול ניסיון שיחה (תאריך/שעה בלבד – תוצאת השיחה ב-F נשארת)
      const c = Number(req.attempt);
      if ([1, 2, 3].indexOf(c) < 0) throw apiError_('BAD_REQUEST', 'מספר ניסיון לא תקין');
      put_(loc, CALL_COLS_[c - 1], '');
      if (c === 1) put_(loc, COL_.call1Time, '');
    } else {
      const n = Number(req.attempt);
      if ([1, 2, 3].indexOf(n) < 0) throw apiError_('BAD_REQUEST', 'מספר ניסיון לא תקין');
      const when = parseLocalDateTime_(req.when);
      if (!when) throw apiError_('BAD_REQUEST', 'תאריך ושעה לא תקינים');
      const col = CALL_COLS_[n - 1];
      if (filled(col) && !req.overwrite) {
        throw apiError_('FILLED', 'ניסיון ' + n + ' כבר מלא ("' + disp[col - 1] + '")');
      }
      if (n === 1) {
        put_(loc, COL_.call1Date, Utilities.formatDate(when, TZ_, 'dd/MM/yyyy'), 'dd/MM/yyyy');
        put_(loc, COL_.call1Time, Utilities.formatDate(when, TZ_, 'HH:mm'), '@');
        const res = req.result == null ? '' : String(req.result).trim();
        if (res) put_(loc, COL_.callResult, res);
      } else {
        put_(loc, col, Utilities.formatDate(when, TZ_, 'dd/MM HH:mm'), '@');
      }
    }
    touch_(null, row, loc.upCol, loc);
    commitFast_(loc);
    phase_('write');
    const n = Number(req.attempt) || (WA_COLS_.indexOf(Object.keys(loc.undo).map(Number)[0]) + 1);
    recordUndo_(ctx.email, loc, (kind === 'wa' ? 'WA ' : 'ניסיון שיחה ') + n, {});
    result = loc;
    result.out = leadAfterWrite_(ctx.cfg, loc);
    if (result.out) CACHE_PATCH_ = result.out;
  });
  const out = { lead: result.out, undoCount: result.undoCount != null ? result.undoCount : undoCount_(ctx.email), redoCount: 0 };
  phase_('build');
  if (req.debug) out.phases = PHASES_;
  return out;
}

// ---------- גוסטינג ----------

function ghostSheet_(cfg) {
  const sh = SpreadsheetApp.openById(cfg.leadsSheetId).getSheetByName(GHOST_TAB_);
  if (!sh) throw apiError_('CONFIG', 'לא נמצאה הלשונית ' + GHOST_TAB_);
  return sh;
}

/**
 * מעתיק ליד ללשונית Ghosting לפי הכותרות בשורה 2 (לא לפי מיקום קבוע).
 * אם כבר קיים שם (לפי טלפון/מייל) – לא מעתיק שוב.
 */
function copyToGhosting_(cfg, lead) {
  const sh = ghostSheet_(cfg);
  const width = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(2, 1, 1, width).getDisplayValues()[0].map(normHeader_);
  const idx = function (name) { return headers.indexOf(name); };
  if (idx('מייל') < 0) return { copied: false, reason: 'בלשונית Ghosting אין עמודת "מייל" – לא הועתק כדי לא לבלגן עמודות' };

  const last = sh.getLastRow();
  if (last >= 3) {
    const data = sh.getRange(3, 1, last - 2, width).getDisplayValues();
    const pk = phoneKey_(lead.phone), em = String(lead.email || '').toLowerCase();
    const dup = data.some(function (r) {
      return (pk && idx('טלפון') >= 0 && phoneKey_(r[idx('טלפון')]) === pk) ||
             (em && em !== '-' && String(r[idx('מייל')]).trim().toLowerCase() === em);
    });
    if (dup) return { copied: false, reason: 'כבר קיים בלשונית Ghosting' };
  }

  const values = {
    'שם מלא': lead.name,
    'טלפון': lead.phone,
    'מייל': lead.email,
    'תאריך כניסה': lead.entry ? fmtDate_(parseIso_(lead.entry)) : lead.entryRaw,
    'מקור': lead.ad || lead.source,
    'ניסיונות שיחה': lead.calls + ' שיחות',
    'WA שנשלחו': lead.was + ' הודעות',
    'הערות': ghostNotes_(lead),
  };
  const out = headers.map(function (h) { return values[h] != null ? values[h] : ''; });
  const target = sh.getRange(last + 1, 1, 1, width);
  target.setNumberFormat('@').setValues([out]);
  invalidateGhost_();
  return { copied: true, row: last + 1, phone: lead.phone, name: lead.name };
}

/** "הערות שי: ... | עיקרי שיחה: ..." (רק החלקים שיש בהם תוכן) */
function ghostNotes_(lead) {
  const parts = [];
  if (String(lead.shaiNotes || '').trim()) parts.push('הערות שי: ' + String(lead.shaiNotes).trim());
  if (String(lead.summary || '').trim()) parts.push('עיקרי שיחה: ' + String(lead.summary).trim());
  return parts.join(' | ');
}

function actionListGhosting_(req, ctx) {
  const cache = CacheService.getScriptCache();
  if (req.fresh) invalidateGhost_();
  const hit = cache.get(GHOST_CACHE_KEY_);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* */ } }
  const data = readGhosting_(ctx);
  const json = JSON.stringify(data);
  if (json.length < 95000) cache.put(GHOST_CACHE_KEY_, json, 300);
  return data;
}

function readGhosting_(ctx) {
  const sh = ghostSheet_(ctx.cfg);
  const width = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(2, 1, 1, width).getDisplayValues()[0].map(normHeader_);
  let used = headers.length;
  while (used > 0 && !headers[used - 1]) used--;
  const last = sh.getLastRow();
  const rows = last >= 3
    ? sh.getRange(3, 1, last - 2, width).getDisplayValues()
        .filter(function (r) { return r.some(function (c) { return String(c).trim(); }); })
    : [];
  // אם יש נתונים מעבר לכותרות (באג ישן) – מציגים גם אותם
  rows.forEach(function (r) {
    for (let i = r.length - 1; i >= used; i--) if (String(r[i]).trim()) { used = i + 1; break; }
  });
  return {
    headers: headers.slice(0, used),
    rows: rows.map(function (r) { return r.slice(0, used); }),
  };
}

// ---------- טריגר עריכה ידנית בגיליון (מותקן ע"י setup) ----------

/** אחרי עריכה ידנית של P/R: S מחושב מחדש לחודשים הפתוחים. חודשים נעולים לא נוגעים. */
function syncRewardsAfterEdit_(e, first, lastRow) {
  const cfg = getConfig_();
  withLock_(function () {
    const r = readLeads_(cfg);
    syncRewards_(r.sh, r.leads, openMonths_(), false);
    // תאריך זום נמחק בתא בודד: אם החודש הישן פתוח, מרוקנים את S של השורה
    if (first === lastRow && e.range.getColumn() === COL_.zoomDate && !String(e.value || '').trim() && e.oldValue != null) {
      const old = parseSheetDate_(e.oldValue, String(e.oldValue), null, false);
      const lead = r.leads.filter(function (l) { return l.row === first; })[0];
      if (old && !isLockedMonth_(monthKey_(old)) && lead && String(lead.reward || '').trim()) {
        r.sh.getRange(first, COL_.reward).setValue('');
      }
    }
  });
}

/** עריכה ידנית בלשונית הלידים → מעדכן "עודכן לאחרונה" בשורות שנערכו. */
function onLeadsEdit(e) {
  const t0 = Date.now();
  try { return onLeadsEditCore_(e); } finally { trackRun_('edit', t0); }
}

function onLeadsEditCore_(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() === GHOST_TAB_) { invalidateGhost_(); return; }
    if (sh.getName() !== LEADS_TAB_) return;
    invalidateLeads_();
    const ex = extraCols_(sh);
    const upCol = ex.updated;
    if (!upCol) return;
    const c1 = e.range.getColumn(), c2 = e.range.getLastColumn();
    const touchesData = c1 <= LAST_BASE_COL_ || (ex.shaiNotes && c1 <= ex.shaiNotes && c2 >= ex.shaiNotes);
    if (!touchesData) return; // למשל עריכה של "עודכן לאחרונה" עצמה
    const first = Math.max(2, e.range.getRow());
    const lastRow = e.range.getLastRow();
    if (lastRow < first || lastRow - first > 50) return;
    const now = nowStamp_();
    const vals = [];
    for (let r = first; r <= lastRow; r++) vals.push([now]);
    sh.getRange(first, upCol, vals.length, 1).setNumberFormat('dd/MM/yyyy HH:mm').setValues(vals);

    if (c1 <= COL_.zoomDate && c2 >= COL_.zoomResult) syncRewardsAfterEdit_(e, first, lastRow);
  } catch (err) {
    console.error(err);
  }
}

/** ליד אחד, טרי מהגיליון (קריאה של השורה בלבד) – לרענון אחרי קביעת זום. */
function actionGetLead_(req, ctx) {
  const loc = locateForWrite_(ctx.cfg, req.row, req.id);
  const lead = publicLead_(loc.lead);
  lead.zoomEvent = futureZoomByLead_()[lead.id] || null;
  return { lead: lead };
}
