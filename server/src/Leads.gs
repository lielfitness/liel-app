/**
 * מודול הלידים: קריאה, עדכון כרטיס, ניסיונות שיחה/WA, גוסטינג.
 * לשונית "לידים פעילים" – לא משנים סדר/שמות עמודות. העמודה "עודכן לאחרונה" נמצאת בסוף (אחרי AF)
 * ומאותרת לפי שם הכותרת, כך שאם היא חסרה הכל ממשיך לעבוד (פשוט בלי חותמת עדכון).
 */

const LEADS_TAB_ = 'לידים פעילים';
const GHOST_TAB_ = 'Ghosting';
const UPDATED_HEADER_ = 'עודכן לאחרונה';

const COL_ = {
  entry: 1, name: 2, phone: 3, email: 4, ad: 5,
  callResult: 6, call1Date: 7, call1Time: 8, call2: 9, wa1: 10, call3: 11, wa2: 12, wa3: 13,
  status: 14, summary: 15, zoomResult: 16, notes: 17, zoomDate: 18, reward: 19,
  source: 20, age: 21, cert: 22, difficulty: 23, improve: 24, change: 25, insta: 26,
};
const CALL_COLS_ = [COL_.call1Date, COL_.call2, COL_.call3];
const WA_COLS_ = [COL_.wa1, COL_.wa2, COL_.wa3];
const LAST_BASE_COL_ = 32; // AF

const STATUSES_ = ['ליד חדש', 'ניסיון שיחה', 'שיחה בוצעה', 'זום נקבע', 'נסגר', 'לא מעוניין', 'לא רלוונטי', 'עתידי', 'Ghosting'];
const FINAL_STATUSES_ = ['נסגר', 'לא מעוניין', 'לא רלוונטי', 'ghosting'];
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

function updatedCol_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol <= LAST_BASE_COL_) return 0;
  const hdr = sh.getRange(1, LAST_BASE_COL_ + 1, 1, lastCol - LAST_BASE_COL_).getDisplayValues()[0];
  const i = hdr.map(normHeader_).indexOf(UPDATED_HEADER_);
  return i < 0 ? 0 : LAST_BASE_COL_ + 1 + i;
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
  return FINAL_STATUSES_.indexOf(String(status || '').trim().toLowerCase()) >= 0;
}

/** קורא את כל הלידים. מחזיר מערך אובייקטים (שורות ריקות מדולגות). */
function readLeads_(cfg) {
  const sh = leadsSheet_(cfg);
  const upCol = updatedCol_(sh);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { sh: sh, upCol: upCol, leads: [] };
  const width = Math.max(LAST_BASE_COL_, upCol);
  const rng = sh.getRange(2, 1, lastRow - 1, width);
  const vals = rng.getValues();
  const disp = rng.getDisplayValues();
  const leads = [];
  let prevEntry = null;
  for (let i = 0; i < vals.length; i++) {
    const lead = buildLead_(i + 2, vals[i], disp[i], prevEntry, upCol);
    if (!lead) continue;
    if (lead._entryDate) prevEntry = lead._entryDate;
    leads.push(lead);
  }
  return { sh: sh, upCol: upCol, leads: leads };
}

function buildLead_(row, v, d, prevEntry, upCol) {
  const g = function (c) { return String(d[c - 1] == null ? '' : d[c - 1]).trim(); };
  if (!g(COL_.name) && !g(COL_.phone) && !g(COL_.email)) return null;

  const entry = parseSheetDate_(v[COL_.entry - 1], d[COL_.entry - 1], prevEntry, false);
  const ref = entry || prevEntry;
  const at = function (c) { return parseSheetDate_(v[c - 1], d[c - 1], ref, true); };
  const zoom = at(COL_.zoomDate);
  const updated = upCol ? parseUpdated_(v[upCol - 1]) : null;

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
    status: status, summary: g(COL_.summary), zoomResult: g(COL_.zoomResult), notes: g(COL_.notes),
    zoomDate: isoDate_(zoom), zoomDateRaw: g(COL_.zoomDate), reward: g(COL_.reward),
    source: g(COL_.source), age: g(COL_.age), cert: g(COL_.cert), difficulty: g(COL_.difficulty),
    improve: g(COL_.improve), change: g(COL_.change), insta: g(COL_.insta),
    updatedAt: updated ? updated.getTime() : 0,
    lastActivity: last,
    untreated: !isFinal_(status) && (!last || Date.now() - last > UNTREATED_MS_),
    _entryDate: entry,
  };
}

function parseUpdated_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  return null;
}

function publicLead_(l) {
  const o = {};
  Object.keys(l).forEach(function (k) { if (k[0] !== '_') o[k] = l[k]; });
  return o;
}

// ---------- פעולות ----------

function actionListLeads_(req, ctx) {
  const r = readLeads_(ctx.cfg);
  return {
    leads: r.leads.map(publicLead_),
    statuses: STATUSES_,
    zoomResults: ZOOM_RESULTS_,
    hasUpdatedCol: !!r.upCol,
    now: Date.now(),
  };
}

/** מאתר את השורה של הליד: קודם לפי מספר השורה, ואם השורה זזה – לפי המזהה. */
function locateLead_(cfg, row, id) {
  const r = readLeads_(cfg);
  let lead = r.leads.filter(function (l) { return l.row === Number(row); })[0];
  if (!lead || lead.id !== id) {
    lead = r.leads.filter(function (l) { return l.id === id; })[0];
  }
  if (!lead) throw apiError_('STALE', 'הליד לא נמצא – אולי השורה השתנתה. רענני את הרשימה.');
  return { sh: r.sh, upCol: r.upCol, lead: lead };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw apiError_('BUSY', 'השרת עסוק, נסי שוב בעוד רגע');
  try { return fn(); } finally { lock.releaseLock(); }
}

function setDateCell_(sh, row, col, date) {
  const c = sh.getRange(row, col);
  if (!date) { c.clearContent(); return; }
  c.setNumberFormat('dd/MM/yyyy').setValue(date);
}

function touch_(sh, row, upCol) {
  if (!upCol) return;
  sh.getRange(row, upCol).setNumberFormat('dd/MM/yyyy HH:mm').setValue(new Date());
}

function rereadLead_(cfg, id) {
  const r = readLeads_(cfg);
  const l = r.leads.filter(function (x) { return x.id === id; })[0];
  return l ? publicLead_(l) : null;
}

function actionUpdateLead_(req, ctx) {
  const fields = req.fields || {};
  let ghost = null;
  const id = withLock_(function () {
    const loc = locateLead_(ctx.cfg, req.row, req.id);
    const sh = loc.sh, lead = loc.lead, row = lead.row;
    let changed = false;

    Object.keys(fields).forEach(function (k) {
      const col = EDITABLE_[k];
      if (!col) return;
      let v = fields[k] == null ? '' : String(fields[k]).trim();
      if (k === 'status' && v && STATUSES_.indexOf(v) < 0) throw apiError_('BAD_REQUEST', 'סטטוס לא מוכר');
      if (k === 'zoomResult' && v && ZOOM_RESULTS_.indexOf(v) < 0) throw apiError_('BAD_REQUEST', 'תוצאת זום לא מוכרת');
      if (k === 'zoomDate') {
        const d = v ? parseIso_(v) : null;
        if (v && !d) throw apiError_('BAD_REQUEST', 'תאריך זום לא תקין');
        if (isoDate_(d) === lead.zoomDate) return;
        setDateCell_(sh, row, col, d);
      } else {
        if (v === lead[k]) return;
        sh.getRange(row, col).setValue(v);
      }
      changed = true;
    });

    if (changed) touch_(sh, row, loc.upCol);

    const newStatus = fields.status != null ? String(fields.status).trim() : lead.status;
    if (newStatus === 'Ghosting' && lead.status !== 'Ghosting') {
      SpreadsheetApp.flush();
      const merged = Object.assign({}, lead, { summary: fields.summary != null ? fields.summary : lead.summary });
      ghost = copyToGhosting_(ctx.cfg, merged);
    }
    return lead.id;
  });
  return { lead: rereadLead_(ctx.cfg, id), ghost: ghost };
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
  const id = withLock_(function () {
    const loc = locateLead_(ctx.cfg, req.row, req.id);
    const sh = loc.sh, lead = loc.lead, row = lead.row;
    const disp = sh.getRange(row, 1, 1, LAST_BASE_COL_).getDisplayValues()[0];
    const filled = function (c) { return !!String(disp[c - 1]).trim(); };

    if (kind === 'wa') {
      let col;
      if (req.attempt) {
        const w = Number(req.attempt);
        if ([1, 2, 3].indexOf(w) < 0) throw apiError_('BAD_REQUEST', 'מספר WA לא תקין');
        col = WA_COLS_[w - 1];
        if (req.clear) {
          sh.getRange(row, col).clearContent();
        } else {
          if (filled(col) && !req.overwrite) throw apiError_('FILLED', 'WA ' + w + ' כבר מסומן');
          setDateCell_(sh, row, col, todayMidnight_());
        }
      } else {
        col = WA_COLS_.filter(function (c) { return !filled(c); })[0];
        if (!col) throw apiError_('FULL', 'כבר נשלחו 3 הודעות WA');
        setDateCell_(sh, row, col, todayMidnight_());
      }
    } else if (req.clear) {
      // ביטול ניסיון שיחה (תאריך/שעה בלבד – תוצאת השיחה ב-F נשארת)
      const c = Number(req.attempt);
      if ([1, 2, 3].indexOf(c) < 0) throw apiError_('BAD_REQUEST', 'מספר ניסיון לא תקין');
      sh.getRange(row, CALL_COLS_[c - 1]).clearContent();
      if (c === 1) sh.getRange(row, COL_.call1Time).clearContent();
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
        setDateCell_(sh, row, COL_.call1Date, new Date(when.getFullYear(), when.getMonth(), when.getDate()));
        sh.getRange(row, COL_.call1Time).setNumberFormat('@').setValue(Utilities.formatDate(when, TZ_, 'HH:mm'));
        const result = req.result == null ? '' : String(req.result).trim();
        if (result) sh.getRange(row, COL_.callResult).setValue(result);
      } else {
        sh.getRange(row, col).setNumberFormat('@').setValue(Utilities.formatDate(when, TZ_, 'dd/MM HH:mm'));
      }
    }
    touch_(sh, row, loc.upCol);
    return lead.id;
  });
  return { lead: rereadLead_(ctx.cfg, id) };
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
    'הערות': lead.summary || '',
  };
  const out = headers.map(function (h) { return values[h] != null ? values[h] : ''; });
  const target = sh.getRange(last + 1, 1, 1, width);
  target.setNumberFormat('@').setValues([out]);
  return { copied: true };
}

function actionListGhosting_(req, ctx) {
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

/** עריכה ידנית בלשונית הלידים → מעדכן "עודכן לאחרונה" בשורות שנערכו. */
function onLeadsEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== LEADS_TAB_) return;
    const upCol = updatedCol_(sh);
    if (!upCol) return;
    if (e.range.getColumn() > LAST_BASE_COL_) return; // עריכה של העמודה עצמה או אחריה
    const first = Math.max(2, e.range.getRow());
    const lastRow = e.range.getLastRow();
    if (lastRow < first || lastRow - first > 50) return;
    const now = new Date();
    const vals = [];
    for (let r = first; r <= lastRow; r++) vals.push([now]);
    sh.getRange(first, upCol, vals.length, 1).setNumberFormat('dd/MM/yyyy HH:mm').setValues(vals);
  } catch (err) {
    console.error(err);
  }
}
