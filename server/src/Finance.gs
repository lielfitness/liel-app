/**
 * שלב 2 – פגישות מאמנים ופיננסים (ליאל בלבד).
 * פעולות שמשנות את D בגיליון תפעול (לחייב / חידוש / הרץ עכשיו) עוברות דרך סקריפט הפגישות עצמו
 * (AppApi.js בפרויקט של גיליון הפיננסים) – אותה לוגיקה ואותה נעילה כמו בגיליון.
 */

/** קריאה ל-Web App של סקריפט הפגישות */
function finCall_(action, params) {
  const cfg = getConfig_();
  const key = PropertiesService.getScriptProperties().getProperty('FINANCE_KEY');
  if (!cfg.financeApiUrl || !key) throw apiError_('CONFIG', 'החיבור לסקריפט הפגישות עוד לא הוגדר (FINANCE_KEY)');
  const res = UrlFetchApp.fetch(cfg.financeApiUrl, {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ action: action, key: key }, params || {})),
  });
  let out;
  try { out = JSON.parse(res.getContentText()); } catch (e) { throw apiError_('ERROR', 'סקריפט הפגישות לא ענה כמו שצריך (' + res.getResponseCode() + ')'); }
  if (!out.ok) throw apiError_(out.error === 'FORBIDDEN' ? 'CONFIG' : 'ERROR', out.error === 'FORBIDDEN' ? 'המפתח FINANCE_KEY לא תואם ל-APP_KEY בסקריפט הפגישות' : out.error);
  return out.data;
}

/** להרצה ידנית מהעורך: בודק את החיבור לסקריפט הפגישות (בלי לשנות כלום) */
function checkFinanceLink() {
  try {
    const d = finCall_('ping');
    console.log(d.sheet ? '✅ החיבור לסקריפט הפגישות תקין – הגיליון: ' + d.sheet
      : '⚠️ החיבור תקין, אבל הסקריפט לא מוצא את הגיליון כשהוא רץ כ-Web App – צריך תיקון לפני שממשיכים');
  } catch (e) {
    console.log('❌ ' + e.message);
  }
}

// ---------- קריאה ----------
const FIN_TABS_ = { coaches: 'תפעול', log: 'יומן פגישות', snap: 'מעקב ביטולים (מערכת)', tx: 'תנועות', summary: 'סיכום לטלגרם (מערכת)' };

function finSs_() { return SpreadsheetApp.openById(getConfig_().finSheetId); }
function finTab_(ss, k) {
  const sh = ss.getSheetByName(FIN_TABS_[k]);
  if (!sh) throw apiError_('CONFIG', 'לא נמצאה הלשונית "' + FIN_TABS_[k] + '" בגיליון הפיננסים');
  return sh;
}
function fmtDay_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ_, 'dd/MM/yyyy') : String(d || ''); }

/** מאמנים + יומן פגישות + ביטולים מאוחרים. נשמר בזיכרון 60 שנ׳ (מתאפס אחרי כל שינוי). */
function coachesData_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) { const hit = cache.get('coach_v1'); if (hit) return JSON.parse(hit); }
  const ss = finSs_();
  const cs = finTab_(ss, 'coaches');
  const coaches = [];
  if (cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, 4).getValues().forEach(function (r, i) {
    if (!String(r[0]).trim()) return;
    coaches.push({ row: i + 2, name: String(r[0]).trim(), email: String(r[1] || '').trim(), pkg: r[2] === '' ? null : Number(r[2]), left: r[3] === '' ? null : Number(r[3]) });
  });
  const log = finTab_(ss, 'log');
  const meetings = [];
  if (log.getLastRow() > 1) log.getRange(2, 1, log.getLastRow() - 1, 11).getValues().forEach(function (r) {
    if (!r[0] && !r[9]) return;
    const start = r[0] instanceof Date ? r[0] : null;
    meetings.push({ id: String(r[9] || ''), at: start ? start.getTime() : 0, date: fmtDay_(r[0]), time: r[1] instanceof Date ? Utilities.formatDate(r[1], TZ_, 'HH:mm') : String(r[1] || ''),
      calName: String(r[2] || ''), email: String(r[3] || '').toLowerCase(), coach: String(r[4] || ''), status: String(r[5] || ''),
      charged: String(r[6] || ''), left: r[8] === '' ? null : r[8] });
  });
  // מתי הפגישה נראתה לאחרונה ביומן (צילום שעתי) – כדי לדעת כמה זמן לפני היא בוטלה
  const snap = finTab_(ss, 'snap');
  const seenAt = {};
  if (snap.getLastRow() > 1) snap.getRange(2, 1, snap.getLastRow() - 1, 6).getValues().forEach(function (r) {
    if (r[0] && r[5] instanceof Date) seenAt[r[0]] = r[5].getTime();
  });
  const late = meetings.filter(function (m) { return m.status.indexOf('ביטול מאוחר') === 0 && (m.charged === 'לא' || m.charged === 'כן'); })
    .map(function (m) {
      const seen = seenAt[m.id];
      return Object.assign({}, m, { hoursBefore: seen && m.at ? Math.max(0, Math.round((m.at - seen) / 36e5 * 2) / 2) : null });
    })
    .sort(function (a, b) { return b.at - a.at; });
  const out = { coaches: coaches, meetings: meetings, late: late, lastRun: String(snap.getRange('I1').getDisplayValue() || '').trim() };
  try { cache.put('coach_v1', JSON.stringify(out), 60); } catch (e) { /* גדול מדי */ }
  return out;
}

function actionCoaches_(req, ctx) {
  const d = coachesData_(!!req.fresh);
  const cleared = clearedLateIds_();
  // טלפון לכל מאמן: לפי המייל בגיליון הלידים (בתפעול אין עמודת טלפון)
  const phones = {};
  try {
    const byEmail = {};
    cachedLeads_(ctx.cfg).leads.forEach(function (l) { const e = String(l.email || '').trim().toLowerCase(); if (e && l.phone) byEmail[e] = l.phone; });
    d.coaches.forEach(function (c) {
      c.email.toLowerCase().split(/[,;\s]+/).some(function (e) { if (byEmail[e]) { phones[c.name] = byEmail[e]; return true; } return false; });
    });
  } catch (e) { /* */ }
  return {
    coaches: d.coaches,
    meetings: d.meetings.map(function (m) { return { id: m.id, at: m.at, date: m.date, time: m.time, email: m.email, coach: m.coach, status: m.status, charged: m.charged, left: m.left }; }),
    late: d.late.filter(function (m) { return !cleared[m.id] && (m.charged === 'לא' || m.at > Date.now() - 45 * DAY_MS_); }),
    phones: phones,
    online: onlineEnsure_(),
    tracks: onbTracks_(),
    gap: coachGapView_(),
    count: coachCount_(),
    lastRun: d.lastRun,
    lastReport: readJsonProp_('MEET_REPORT', null),
  };
}

// ---------- "נקה" לביטול מאוחר: ראיתי, לא מחייבים (נשמר במערכת של האפליקציה, לא בגיליון) ----------
function clearedLateIds_() {
  const out = {};
  sysRows_('lateClear').rows.forEach(function (r) { if (r[0]) out[r[0]] = 1; });
  return out;
}
function actionLateClear_(req, ctx) {
  const id = String(req.id || '');
  if (!id) throw apiError_('BAD_REQUEST', 'חסר מזהה');
  const d = sysRows_('lateClear');
  if (req.undo) {
    for (let i = d.rows.length - 1; i >= 0; i--) if (d.rows[i][0] === id) d.sh.deleteRow(i + 2);
    return { ok: true };
  }
  if (!d.rows.some(function (r) { return r[0] === id; })) {
    d.sh.appendRow([id, Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy HH:mm'), String(req.coach || ''), String(req.date || '')]);
  }
  return { ok: true };
}

// ---------- מתאמני אונליין: לשונית בגיליון הפיננסים, רק להצגה ----------
const ONLINE_TAB_ = 'מתאמני אונליין';
function onlineSheet_(create) {
  const ss = finSs_();
  let sh = ss.getSheetByName(ONLINE_TAB_);
  if (sh || !create) return sh;
  sh = ss.insertSheet(ONLINE_TAB_, ss.getSheets().length);
  sh.getRange(1, 1, 1, 3).setValues([['שם', 'סכום חודשי (₪)', 'נוסף בתאריך']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setRightToLeft(true);
  // פעם ראשונה: מעתיקים את הרשימה שליאל ניהל ב"תפעול" (E סכום, F שם). "תפעול" עצמו לא משתנה.
  const op = ss.getSheetByName('תפעול');
  if (op && op.getLastRow() > 1) {
    const today = Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy');
    const rows = op.getRange(2, 5, op.getLastRow() - 1, 2).getValues()
      .filter(function (r) { return String(r[1]).trim() && String(r[1]).trim() !== 'סה״כ' && String(r[1]).trim() !== 'סה"כ' && Number(String(r[0]).replace(/[,₪\s]/g, '')) > 0; })
      .map(function (r) { return [String(r[1]).trim(), Number(String(r[0]).replace(/[,₪\s]/g, '')), today]; });
    if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  return sh;
}
function onlineList_() {
  const sh = onlineSheet_(false);
  if (!sh || sh.getLastRow() < 2) return sh ? [] : null;   // null = הלשונית עוד לא נוצרה
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { name: String(r[0]).trim(), amount: Number(r[1]) || 0 }; });
}
function actionOnline_(req, ctx) {
  let out = null;
  finLock_(function () {
    const sh = onlineSheet_(true);
    if (req.op === 'add') {
      const name = String(req.name || '').trim().slice(0, 80);
      const amount = Number(String(req.amount).replace(/[,₪\s]/g, ''));
      if (!name) throw apiError_('BAD_REQUEST', 'חסר שם');
      if (!(amount > 0 && amount < 1e5)) throw apiError_('BAD_REQUEST', 'סכום לא תקין');
      sh.appendRow([name, amount, Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy')]);
    } else if (req.op === 'remove') {
      const n = sh.getLastRow() - 1;
      const vals = n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [];
      let row = 0;
      for (let i = vals.length - 1; i >= 0; i--) {
        if (String(vals[i][0]).trim() === String(req.name || '').trim() && Number(vals[i][1]) === Number(req.amount)) { row = i + 2; break; }
      }
      if (!row) throw apiError_('NOT_FOUND', 'לא נמצא ברשימה – אולי כבר הוסר');
      sh.deleteRow(row);
    }
    out = { online: onlineList_() || [] };
  });
  return out;
}

function actionCoach_(req, ctx) {
  const d = coachesData_(!!req.fresh);
  const c = d.coaches.filter(function (x) { return x.name === req.name; })[0];
  if (!c) throw apiError_('NOT_FOUND', 'המאמן לא נמצא בגיליון תפעול');
  const emails = c.email.toLowerCase().split(/[,;\s]+/).filter(function (e) { return e.indexOf('@') > 0; });
  const history = d.meetings.filter(function (m) { return m.coach === c.name || (m.email && emails.indexOf(m.email) >= 0); })
    .sort(function (a, b) { return b.at - a.at; });
  // טלפון: לפי המייל בגיליון הלידים (בתפעול אין עמודת טלפון)
  let phone = '';
  try {
    const l = cachedLeads_(ctx.cfg).leads.filter(function (x) { return x.phone && emails.indexOf(String(x.email || '').trim().toLowerCase()) >= 0; }).pop();
    if (l) phone = l.phone;
  } catch (e) { /* */ }
  return { coach: c, history: history, phone: phone };
}

// ---------- פעולות שעוברות דרך סקריפט הפגישות ----------
function actionLateCharge_(req, ctx) {
  const r = finCall_('charge', { id: String(req.id || ''), want: req.want === true });
  CacheService.getScriptCache().remove('coach_v1');
  return r;
}
function actionCoachRenew_(req, ctx) {
  // בתפעול יכולים להיות כמה מיילים בתא – הסקריפט בודק שהמייל הראשון שייך למאמן
  const r = finCall_('renew', { name: req.name, email: String(req.email || '').split(/[,;\s]+/)[0], n: Number(req.n) });
  CacheService.getScriptCache().remove('coach_v1');
  return r;
}
function actionRunMeetings_(req, ctx) {
  try { finCall_('run'); } catch (e) {
    if (/timed? ?out|timeout|deadline/i.test(String(e.message))) return { ran: true, message: 'ההורדה עדיין רצה – הסיכום יגיע בטלגרם' };
    throw e;
  }
  CacheService.getScriptCache().remove('coach_v1');
  return { ran: true, message: 'ההורדה הסתיימה – הסיכום נשלח בטלגרם' };
}

// ---------- פיננסים ----------
const TX_ = { date: 1, source: 2, desc: 3, type: 4, amount: 5, cat: 6, biz: 7, vat: 8, state: 9, id: 10, note: 11 };

function monthRow_(sh, d) {
  const row = d.getMonth() + 2;   // שורה 2 = ינואר
  const v = sh.getRange(row, 1, 1, 12).getValues()[0];
  const num = function (x) { return typeof x === 'number' ? x : null; };
  return { label: String(v[11] || ''), net: num(v[0]), expenses: num(v[6]), expensesNet: num(v[5]), income: num(v[8]), incomeNet: num(v[7]) };
}

/** הסיכום השבועי מחולק לפי כותרות (🔴 דוח חייבים, 🧾 התאמת חשבוניות וכו') */
function splitSummary_(text) {
  const parts = {};
  String(text || '').split(/\n\s*\n/).forEach(function (block) {
    const m = block.trim().match(/^(🔴|🧾|❓|⚠️|📲|💰|💸)\s*([^\n]*)\n?([\s\S]*)$/);
    if (m) parts[m[1]] = { title: m[2].replace(/:$/, '').trim(), body: m[3].trim() };
  });
  return parts;
}

function actionFinance_(req, ctx) {
  const ss = finSs_();
  const year = ss.getSheetByName(String(new Date().getFullYear()));
  const now = new Date();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let months = [];
  if (year) {
    months.push(monthRow_(year, now));
    const prevYear = prevDate.getFullYear() === now.getFullYear() ? year : ss.getSheetByName(String(prevDate.getFullYear()));
    if (prevYear) months.push(monthRow_(prevYear, prevDate));
  }
  const tx = finTab_(ss, 'tx');
  const review = [];
  const txVals = tx.getLastRow() > 1 ? tx.getRange(2, 1, tx.getLastRow() - 1, 11).getDisplayValues() : [];
  {
    txVals.forEach(function (r) {
      if (String(r[TX_.biz - 1]).trim() !== 'לבדיקה') return;
      review.push({ id: r[TX_.id - 1], date: r[0], source: r[1], desc: r[2], type: r[3], amount: r[4], cat: r[5], note: r[10] });
    });
  }
  const sum = finTab_(ss, 'summary');
  const text = String(sum.getRange('A1').getValue() || '');
  const parts = splitSummary_(text);
  const cleared = clearedDebts_(ss);
  const debts = parts['🔴'] ? parseDebts_(parts['🔴'].body).map(function (it) {
    return it.key ? Object.assign(it, { cleared: !!cleared[it.key] }) : it;
  }) : null;
  return {
    months: months,
    lastUpdate: year ? year.getRange('K17').getDisplayValue() : '',
    review: review,
    month: monthLists_(txVals, now.getFullYear(), now.getMonth() + 1),
    prevMonth: monthLists_(txVals, prevDate.getFullYear(), prevDate.getMonth() + 1),
    year: year ? yearTotals_(year) : null,
    fixed: fixedExpenses_(ss),
    balance: balances_(ss),
    forecast: forecast_(ss, now),
    summary: { text: text, at: sum.getRange('B1').getDisplayValue(),
      debts: parts['🔴'] ? { title: parts['🔴'].title, items: debts } : null,
      anomalies: parts['⚠️'] ? { title: parts['⚠️'].title, items: anomalyItems_(parts['⚠️'].body) } : null,
      invoices: parts['🧾'] || null },
    reminders: (function () { try { return remList_(); } catch (e) { console.warn('reminders: ' + e); return []; } })(),
  };
}

/** מוצא שורה ב"תנועות" לפי המזהה (J) */
function txRow_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (!id || n < 1) return 0;
  const ids = sh.getRange(2, TX_.id, n, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

/** ✅ עסקי / ❌ פרטי לשורה "לבדיקה". undo: מחזיר את מה שהיה (רק אם אף אחד לא שינה בינתיים). */
function actionFinDecide_(req, ctx) {
  let out = null;
  finLock_(function () {
    const sh = finTab_(finSs_(), 'tx');
    const row = txRow_(sh, String(req.id || ''));
    if (!row) throw apiError_('NOT_FOUND', 'השורה לא נמצאה ב"תנועות" – אולי העדכון השבועי שינה אותה');
    const rng = sh.getRange(row, 1, 1, 11);
    const cur = rng.getDisplayValues()[0];
    if (req.undo) {
      const p = req.undo;
      if (cur[TX_.biz - 1] !== p.wrote) throw apiError_('STALE', 'השורה שונתה מאז – לא החזרתי');
      sh.getRange(row, TX_.cat).setValue(p.cat);
      sh.getRange(row, TX_.biz).setValue(p.biz);
      sh.getRange(row, TX_.note).setValue(p.note);
      out = { ok: true, undone: true };
      CacheService.getScriptCache().remove('finrev_v1');
      return;
    }
    if (String(cur[TX_.biz - 1]).trim() !== 'לבדיקה') throw apiError_('STALE', 'השורה כבר סווגה (' + cur[TX_.biz - 1] + ')');
    const biz = req.business === true;
    const isBit = cur[TX_.type - 1] === 'הכנסה' && /ביט/.test(cur[TX_.source - 1] + ' ' + cur[TX_.desc - 1]);
    const note = 'החלטת ליאל ' + Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy') + ' (מהאפליקציה): ' + (biz ? 'עסקי' : 'פרטי') +
      (isBit ? ' – החלטה חד-פעמית (ביט), לא להפוך לכלל' : '');
    const prev = { cat: cur[TX_.cat - 1], biz: cur[TX_.biz - 1], note: cur[TX_.note - 1] };
    sh.getRange(row, TX_.biz).setValue(biz ? 'כן' : 'לא');
    if (!biz) sh.getRange(row, TX_.cat).setValue('פרטי');
    sh.getRange(row, TX_.note).setValue(prev.note ? prev.note + ' | ' + note : note);
    out = { ok: true, undo: Object.assign({ wrote: biz ? 'כן' : 'לא' }, prev) };
    CacheService.getScriptCache().remove('finrev_v1');
  });
  return out;
}

/** הכנסה ידנית: שורה חדשה בסוף "תנועות", באותו פורמט כמו השורות manual-… שליאל הוסיף */
const INCOME_SRC_ = {
  bit:  { b: 'ביט',      cat: 'הכנסות ביט' },
  bank: { b: 'עו"ש עסקי', cat: 'הכנסות העברה בנקאית' },
  cash: { b: 'מזומן',    cat: 'הכנסות מזומן' },
};
function actionFinAddIncome_(req, ctx) {
  const src = INCOME_SRC_[req.source];
  if (!src) throw apiError_('BAD_REQUEST', 'מקור לא מוכר');
  const amount = Math.round(Number(String(req.amount).replace(/[,₪\s]/g, '')) * 100) / 100;
  if (!(amount > 0 && amount < 1e6)) throw apiError_('BAD_REQUEST', 'סכום לא תקין');
  const m = String(req.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw apiError_('BAD_REQUEST', 'תאריך לא תקין');
  const desc = String(req.desc || '').trim().slice(0, 200);
  if (!desc) throw apiError_('BAD_REQUEST', 'חסר תיאור');
  const id = 'manual-' + req.source + '-' + m[1] + m[2] + m[3] + '-' + (amount % 1 ? String(amount) : String(Math.round(amount)));
  let out = null;
  finLock_(function () {
    const sh = finTab_(finSs_(), 'tx');
    if (txRow_(sh, id)) throw apiError_('DUPLICATE', 'כבר קיימת הכנסה ידנית באותו תאריך, מקור וסכום (' + id + ')');
    const last = sh.getLastRow();
    const note = 'נרשם מהאפליקציה ' + Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy');
    sh.appendRow([new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12), src.b, desc, 'הכנסה', amount, src.cat, 'כן', 'לא', 'בוצע', id, note]);
    const row = sh.getLastRow();
    if (last >= 2) sh.getRange(last, 1, 1, 11).copyTo(sh.getRange(row, 1, 1, 11), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    out = { ok: true, id: id, row: row, desc: desc, amount: amount };
  });
  return out;
}

/** לכרטיסים במסך הבית */
function finHomeCounts_() {
  try {
    const d = coachesData_(false);
    return {
      lateUncharged: d.late.filter(function (m) { return m.charged === 'לא'; }).length,
      lowCoaches: d.coaches.filter(function (c) { return c.left != null && c.left <= 2; }).length,
      review: finReviewCount_(),
    };
  } catch (e) { return null; }
}

function finReviewCount_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('finrev_v1');
  if (hit != null) return Number(hit);
  const sh = finTab_(finSs_(), 'tx');
  const n = sh.getLastRow() - 1;
  const c = n > 0 ? sh.getRange(2, TX_.biz, n, 1).getDisplayValues().filter(function (r) { return String(r[0]).trim() === 'לבדיקה'; }).length : 0;
  cache.put('finrev_v1', String(c), 120);
  return c;
}


// ---------- הכנסות / הוצאות החודש (מ"תנועות": עסקי = כן, מה-1 לחודש) ----------
function monthLists_(vals, yy, mm) {
  const amt = function (s) { return Number(String(s).replace(/[,₪\s]/g, '')) || 0; };
  const income = [], expenses = [];
  vals.forEach(function (r) {
    const m = String(r[0]).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m || Number(m[2]) !== mm || Number(m[3]) !== yy) return;
    if (String(r[TX_.biz - 1]).trim() !== 'כן') return;
    const item = { id: r[TX_.id - 1], date: r[0], day: Number(m[1]), amount: amt(r[TX_.amount - 1]) };
    if (r[TX_.type - 1] === 'הכנסה') {
      item.name = String(r[2]).replace(/^עסקה\s*-\s*/, '').replace(/\s*\(\d+\s*תשלומים\)\s*$/, '').trim();
      const src = String(r[1]), cat = String(r[5]);
      item.source = /קארדקום/.test(src) ? 'קארדקום' : (/ביט/.test(src + cat) ? 'ביט' : (/מזומן/.test(src + cat) ? 'מזומן' : (/עו"ש|העברה/.test(src + cat) ? 'העברה בנקאית' : src)));
      income.push(item);
    } else if (r[TX_.type - 1] === 'הוצאה') {
      item.name = String(r[2]).trim();
      expenses.push(item);
    }
  });
  const byDay = function (a, b) { return a.day - b.day; };
  return { income: income.sort(byDay), expenses: expenses.sort(byDay) };
}

// ---------- דוח חייבים: פריטים + "נקה" ----------
const DEBT_TAB_ = 'חייבים שנוקו (מערכת)';
const DEBT_HEAD_ = ['תאריך ניקוי', 'סוג', 'שם לקוח', 'סכום', 'תאריך החוב'];

/** "עסקאות שלא עברו:\nללא שם - ₪8,800 - 18/10 - 12 תשלומים, …" → פריטים */
function parseDebts_(body) {
  const items = [];
  let type = '';
  String(body || '').split('\n').forEach(function (line) {
    const t = line.trim();
    if (!t) return;
    // כותרת, ולפעמים באותה שורה גם תוכן ("עסקאות שלא עברו: אין", "הוראות קבע: הבדיקה מהמק נכשלה…")
    const hm = t.match(/^(עסקאות שלא עברו|הוראות קבע(?: שלא עברו)?)\s*:?\s*(.*)$/);
    if (hm) { type = /^עסקאות/.test(hm[1]) ? 'עסקה שלא עברה' : 'הוראת קבע'; items.push({ head: hm[1] + ':', note: hm[2] }); return; }
    const m = t.match(/^(.+?)\s+-\s+₪\s*([\d,.]+)\s+-\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:-\s*)?(.*)$/);
    if (m && type) {
      const amount = Number(m[2].replace(/,/g, ''));
      items.push({ type: type, name: m[1].trim(), amount: amount, date: m[3], extra: m[4].trim(), text: t,
        key: debtKey_(type, m[1].trim(), amount, m[3]) });
    } else items.push({ text: t });
  });
  return items;
}
function debtKey_(type, name, amount, date) {
  const d = String(date).split('/');
  return [type, String(name).trim(), Number(amount), Number(d[0]) + '/' + Number(d[1])].join('|');
}
function debtSheet_(ss, create) {
  let sh = ss.getSheetByName(DEBT_TAB_);
  if (sh || !create) return sh;
  sh = ss.insertSheet(DEBT_TAB_, ss.getSheets().length);
  sh.getRange(1, 1, 1, DEBT_HEAD_.length).setValues([DEBT_HEAD_]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setRightToLeft(true);
  sh.getRange('A:E').setNumberFormat('@');
  sh.hideSheet();
  return sh;
}
function clearedDebts_(ss) {
  const sh = debtSheet_(ss, false);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
    out[debtKey_(r[1], r[2], Number(String(r[3]).replace(/[,₪\s]/g, '')), r[4])] = 1;
  });
  return out;
}
function actionDebtClear_(req, ctx) {
  const type = req.type === 'הוראת קבע' ? 'הוראת קבע' : 'עסקה שלא עברה';
  const name = String(req.name || '').trim(), amount = Number(req.amount), date = String(req.date || '').trim();
  if (!name || !(amount > 0) || !date) throw apiError_('BAD_REQUEST', 'פריט לא תקין');
  const key = debtKey_(type, name, amount, date);
  let out = null;
  finLock_(function () {
    const sh = debtSheet_(finSs_(), true);
    const n = sh.getLastRow() - 1;
    const vals = n > 0 ? sh.getRange(2, 1, n, 5).getDisplayValues() : [];
    const rowOf = function () {
      for (let i = vals.length - 1; i >= 0; i--) {
        if (debtKey_(vals[i][1], vals[i][2], Number(String(vals[i][3]).replace(/[,₪\s]/g, '')), vals[i][4]) === key) return i + 2;
      }
      return 0;
    };
    if (req.undo) { const r = rowOf(); if (r) sh.deleteRow(r); out = { ok: true }; return; }
    if (!rowOf()) sh.appendRow([Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy'), type, name, String(amount), date]);
    out = { ok: true };
  });
  return out;
}

// ---------- הוצאה ידנית ----------
const EXP_METHOD_ = { card: 'כרטיס אשראי', bank: 'עו"ש עסקי', cash: 'מזומן', bit: 'ביט' };
function actionFinAddExpense_(req, ctx) {
  const method = EXP_METHOD_[req.method];
  if (!method) throw apiError_('BAD_REQUEST', 'אמצעי תשלום לא מוכר');
  const amount = Math.round(Number(String(req.amount).replace(/[,₪\s]/g, '')) * 100) / 100;
  if (!(amount > 0 && amount < 1e6)) throw apiError_('BAD_REQUEST', 'סכום לא תקין');
  const m = String(req.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw apiError_('BAD_REQUEST', 'תאריך לא תקין');
  const desc = String(req.desc || '').trim().slice(0, 200);
  if (!desc) throw apiError_('BAD_REQUEST', 'חסר שם הוצאה');
  const id = 'manual-exp-' + m[1] + m[2] + m[3] + '-' + (amount % 1 ? String(amount) : String(Math.round(amount)));
  let out = null;
  finLock_(function () {
    const sh = finTab_(finSs_(), 'tx');
    if (txRow_(sh, id)) throw apiError_('DUPLICATE', 'כבר קיימת הוצאה ידנית באותו תאריך ובאותו סכום (' + id + ')');
    const last = sh.getLastRow();
    const note = 'נרשם מהאפליקציה ' + Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy') + ' · אמצעי: ' + method;
    sh.appendRow([new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12), method, desc, 'הוצאה', amount, 'הוצאה ידנית', 'כן', req.vat ? 'כן' : 'לא', 'בוצע', id, note]);
    const row = sh.getLastRow();
    if (last >= 2) sh.getRange(last, 1, 1, 11).copyTo(sh.getRange(row, 1, 1, 11), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    out = { ok: true, id: id, desc: desc, amount: amount };
  });
  return out;
}

/** ↶ להכנסה/הוצאה ידנית: מוחק את השורה – רק אם לא שונתה מאז שנוספה */
function actionFinRemoveManual_(req, ctx) {
  const id = String(req.id || '');
  if (!/^manual-/.test(id)) throw apiError_('BAD_REQUEST', 'אפשר למחוק רק שורה ידנית');
  let out = null;
  finLock_(function () {
    const sh = finTab_(finSs_(), 'tx');
    const row = txRow_(sh, id);
    if (!row) { out = { ok: true, gone: true }; return; }
    const r = sh.getRange(row, 1, 1, 11).getDisplayValues()[0];
    const amount = Number(String(r[TX_.amount - 1]).replace(/[,₪\s]/g, ''));
    if (String(r[TX_.desc - 1]).trim() !== String(req.desc || '').trim() || amount !== Number(req.amount) || r[TX_.biz - 1] !== 'כן') {
      throw apiError_('STALE', 'השורה שונתה מאז שנוספה (אולי ע"י העדכון השבועי) – לא מחקתי');
    }
    sh.deleteRow(row);
    out = { ok: true };
  });
  return out;
}

/** בפעם הראשונה שמסך המאמנים נטען – יוצר את הלשונית (עם הרשימה מ"תפעול") */
function onlineEnsure_() {
  const l = onlineList_();
  if (l) return l;
  let out = [];
  finLock_(function () { onlineSheet_(true); out = onlineList_() || []; });
  return out;
}

/** נעילה לפעולות בגיליון הפיננסים – בלי לאפס את הזיכרון של רשימת הלידים */
function finLock_(fn) {
  return withLock_(function () { const r = fn(); CACHE_PATCH_ = 'skip'; return r; });
}

// ---------- ⚠️ חריגים: "נקה" לכל פריט (נשמר במערכת של האפליקציה) ----------
function anomalyKey_(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
/** השוואה יציבה: בלי מספרים, ₪, אחוזים ופסיקים – כך שאותו חריג עם סכום מעודכן נשאר "נוקה" (חודש אחר = טקסט אחר) */
function anomalyStable_(t) { return anomalyKey_(t).replace(/[0-9₪%,.+\-]/g, '').replace(/\s+/g, ' ').trim(); }
function anomalyItems_(body) {
  const cleared = {};
  sysRows_('anomClear').rows.forEach(function (r) { if (r[0]) cleared[anomalyStable_(r[0])] = 1; });
  return String(body || '').split('\n').map(function (t) { return t.trim(); }).filter(Boolean)
    .map(function (t) { const k = anomalyKey_(t); return { text: t, key: k, cleared: !!cleared[anomalyStable_(k)] }; });
}
function actionAnomClear_(req, ctx) {
  const key = anomalyKey_(req.key);
  if (!key) throw apiError_('BAD_REQUEST', 'פריט לא תקין');
  const d = sysRows_('anomClear');
  const st = anomalyStable_(key);
  if (req.undo) {
    for (let i = d.rows.length - 1; i >= 0; i--) if (anomalyStable_(d.rows[i][0]) === st) d.sh.deleteRow(i + 2);
  } else if (!d.rows.some(function (r) { return anomalyStable_(r[0]) === st; })) {
    d.sh.appendRow([key, Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy HH:mm')]);
  }
  return { ok: true };
}

// ---------- השנה: שורת "סה״כ שנתי" בלשונית השנה (אותן עמודות כמו הריבוע החודשי) ----------
function yearTotals_(sh) {
  const n = Math.min(sh.getLastRow(), 30);
  const vals = sh.getRange(1, 1, n, 12).getValues();
  const num = function (x) { return typeof x === 'number' ? x : null; };
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][11]).trim() === 'סה״כ שנתי' || String(vals[i][11]).trim() === 'סה"כ שנתי') {
      return { income: num(vals[i][8]), expenses: num(vals[i][6]), net: num(vals[i][0]) };
    }
  }
  // אין שורת סיכום – מסכמים את חודשי השנה עד החודש הנוכחי (שורה 2 = ינואר)
  const out = { income: 0, expenses: 0, net: 0 };
  for (let m = 0; m <= new Date().getMonth(); m++) {
    const r = vals[m + 1] || [];
    out.income += num(r[8]) || 0; out.expenses += num(r[6]) || 0; out.net += num(r[0]) || 0;
  }
  return out;
}

// ---------- נספחים: הוצאות קבועות ----------
function fixedExpenses_(ss) {
  const sh = ss.getSheetByName('הוצאות קבועות');
  if (!sh || sh.getLastRow() < 2) return null;
  const vals = sh.getRange(1, 1, sh.getLastRow(), 7).getDisplayValues();
  const head = vals[0];
  const col = function (name) { return head.findIndex(function (h) { return String(h).indexOf(name) === 0; }); };
  const cName = 0, cAmt = col('סכום'), cFreq = col('תדירות'), cLast = col('חיוב אחרון');
  const items = [];
  let total = null;
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const name = String(r[cName] || '').trim();
    if (!name) continue;
    if (/^סה.?כ/.test(name)) { total = r[cAmt]; continue; }
    if (!r[cAmt] && !r[cFreq]) continue;   // הערות בתחתית
    items.push({ name: name, amount: cAmt >= 0 ? r[cAmt] : '', freq: cFreq >= 0 ? r[cFreq] : '', last: cLast >= 0 ? r[cLast] : '' });
  }
  return { items: items, total: total };
}

// ---------- יתרה בעו"ש + חיוב הבא בכאל (לשונית "יתרות (מערכת)", שורה 2) ----------
function balances_(ss) {
  const sh = ss.getSheetByName('יתרות (מערכת)');
  if (!sh || sh.getLastRow() < 2) return null;
  const r = sh.getRange(2, 1, 1, 6).getDisplayValues()[0];
  const num = function (x) { const n = Number(String(x).replace(/[,₪\s]/g, '')); return String(x).trim() === '' || isNaN(n) ? null : n; };
  return { updated: r[0], balance: num(r[1]), asOf: r[2], nextCharge: num(r[3]), chargeDate: r[4], note: r[5],
    error: /^שגיאה/.test(String(r[5]).trim()) };
}

// ---------- צפוי להיכנס מקארדקום בחודש הבא (לשונית "קארדקום תחזית (מערכת)") ----------
function forecast_(ss, now) {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const out = { month: next.getMonth() + 1, year: next.getFullYear(), total: null, items: [] };
  const sh = ss.getSheetByName('קארדקום תחזית (מערכת)');
  if (!sh || sh.getLastRow() < 1) return out;
  const status = String(sh.getRange('H1').getDisplayValue()).trim();
  out.updated = sh.getRange('B1').getDisplayValue();
  if (status !== 'OK') { out.error = status; return out; }
  if (sh.getLastRow() < 4) return out;
  sh.getRange(4, 1, sh.getLastRow() - 3, 2).getDisplayValues().forEach(function (r) {
    const s = String(r[0]).trim();
    let d = null, m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) d = { y: +m[1], mo: +m[2], day: +m[3] };
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) d = { y: +m[3], mo: +m[2], day: +m[1] };
    const amt = Number(String(r[1]).replace(/[,₪\s]/g, ''));
    if (!d || isNaN(amt) || d.y !== out.year || d.mo !== out.month) return;
    out.items.push({ date: ('0' + d.day).slice(-2) + '/' + ('0' + d.mo).slice(-2), day: d.day, amount: amt });
  });
  out.items.sort(function (a, b) { return a.day - b.day; });
  if (out.items.length) out.total = Math.round(out.items.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100;
  return out;
}

// ---------- הוספת מאמן ידנית / הורדת פגישה ידנית (ליאל) – דרך סקריפט הפגישות, עם ↶/↷ ----------
function actionCoachAdd_(req, ctx) {
  const name = String(req.name || '').trim(), email = String(req.email || '').trim().toLowerCase(), n = Number(req.n);
  if (name.length < 2) throw apiError_('BAD_REQUEST', 'חסר שם');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw apiError_('BAD_REQUEST', 'מייל לא תקין');
  if (!(Number.isInteger(n) && n >= 1 && n <= 50)) throw apiError_('BAD_REQUEST', 'מספר פגישות צריך להיות שלם בין 1 ל-50');
  let out = null, dup = null;
  finLock_(function () {
    dup = opSeen_(req); if (dup) return;
    const r = finCall_('coachAdd', { name: name, email: email, n: n });
    if (r.exists) { out = { exists: true, message: (r.name || name) + ' כבר ברשימה (לפי המייל)' }; opMark_(req, out); return; }
    pushUndoEntry_(ctx.email, { kind: 'coachAdd', row: r.row, name: name, email: email, n: n, desc: 'הוספת מאמן', changes: [] });
    out = { added: true, row: r.row };
    opMark_(req, out);
  });
  CacheService.getScriptCache().remove('coach_v1');
  if (dup) return opDupOut_(dup, ctx);
  return Object.assign(out, { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) });
}

function actionCoachMinus_(req, ctx) {
  let out = null, dup = null;
  finLock_(function () {
    dup = opSeen_(req); if (dup) return;
    const r = finCall_('minus', { name: req.name, email: String(req.email || '').split(/[,;\s]+/)[0], ref: req.opId || '' });
    pushUndoEntry_(ctx.email, { kind: 'coachMinus', logId: r.logId, name: r.coach, email: String(req.email || ''), desc: 'הורדת פגישה', changes: [] });
    out = { left: r.left };
    opMark_(req, out);
  });
  CacheService.getScriptCache().remove('coach_v1');
  if (dup) return opDupOut_(dup, ctx);
  return Object.assign(out, { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) });
}

/** ↶/↷ להוספת מאמן ולהורדת פגישה (נקרא מתוך undoRedo_, בתוך הנעילה) */
function coachUndoRedo_(e, to, verb, ctx) {
  const say = function (what) { return verb + ': ' + what + ' – ' + e.name; };
  try {
    if (e.kind === 'coachAdd') {
      finCall_('coachAddUndo', { row: e.row, name: e.name, email: e.email });
      pushStack_(to, ctx.email, { kind: 'coachAddRedo', name: e.name, email: e.email, n: e.n, desc: 'הוספת מאמן', changes: [] });
      return { done: true, message: say('הוספת מאמן'), coach: true };
    }
    if (e.kind === 'coachAddRedo') {
      const r = finCall_('coachAdd', { name: e.name, email: e.email, n: e.n });
      if (r.exists) return { done: false, message: e.name + ' כבר ברשימה – לא הוספתי שוב' };
      pushStack_(to, ctx.email, { kind: 'coachAdd', row: r.row, name: e.name, email: e.email, n: e.n, desc: 'הוספת מאמן', changes: [] });
      return { done: true, message: say('הוספת מאמן'), coach: true };
    }
    if (e.kind === 'coachMinus') {
      const r = finCall_('minusUndo', { logId: e.logId });
      pushStack_(to, ctx.email, { kind: 'coachMinusRedo', name: e.name, email: e.email, desc: 'הורדת פגישה', changes: [] });
      return { done: true, message: say('הורדת פגישה') + ' (נשארו ' + r.left + ')', coach: true };
    }
    if (e.kind === 'coachMinusRedo') {
      const r = finCall_('minus', { name: e.name, email: String(e.email || '').split(/[,;\s]+/)[0] });
      pushStack_(to, ctx.email, { kind: 'coachMinus', logId: r.logId, name: e.name, email: e.email, desc: 'הורדת פגישה', changes: [] });
      return { done: true, message: say('הורדת פגישה') + ' (נשארו ' + r.left + ')', coach: true };
    }
  } catch (err) {
    return { done: false, message: 'אי אפשר ל' + (verb === 'בוטל' ? 'בטל' : 'בצע שוב') + ': ' + (err.message || err) };
  } finally { CacheService.getScriptCache().remove('coach_v1'); }
  return null;
}
