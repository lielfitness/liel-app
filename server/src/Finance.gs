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
  return { coaches: d.coaches, late: d.late.filter(function (m) { return m.charged === 'לא' || m.at > Date.now() - 45 * DAY_MS_; }), lastRun: d.lastRun };
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
  if (tx.getLastRow() > 1) {
    const vals = tx.getRange(2, 1, tx.getLastRow() - 1, 11).getDisplayValues();
    vals.forEach(function (r) {
      if (String(r[TX_.biz - 1]).trim() !== 'לבדיקה') return;
      review.push({ id: r[TX_.id - 1], date: r[0], source: r[1], desc: r[2], type: r[3], amount: r[4], cat: r[5], note: r[10] });
    });
  }
  const sum = finTab_(ss, 'summary');
  const text = String(sum.getRange('A1').getValue() || '');
  const parts = splitSummary_(text);
  return {
    months: months,
    lastUpdate: year ? year.getRange('K17').getDisplayValue() : '',
    review: review,
    summary: { text: text, at: sum.getRange('B1').getDisplayValue(), debts: parts['🔴'] || null, invoices: parts['🧾'] || null },
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
  withLock_(function () {
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
  withLock_(function () {
    const sh = finTab_(finSs_(), 'tx');
    if (txRow_(sh, id)) throw apiError_('DUPLICATE', 'כבר קיימת הכנסה ידנית באותו תאריך, מקור וסכום (' + id + ')');
    const last = sh.getLastRow();
    const note = 'נרשם מהאפליקציה ' + Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy');
    sh.appendRow([new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), src.b, desc, 'הכנסה', amount, src.cat, 'כן', 'לא', 'בוצע', id, note]);
    const row = sh.getLastRow();
    if (last >= 2) sh.getRange(last, 1, 1, 11).copyTo(sh.getRange(row, 1, 1, 11), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    out = { ok: true, id: id, row: row };
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
