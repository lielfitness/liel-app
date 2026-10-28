/**
 * תזכורות – שתי רשימות באותה לשונית מוסתרת "תזכורות (מערכת)" בגיליון המערכת של האפליקציה:
 *   פיננסים (ליאל): עמודה H ריקה. התראה יום לפני ב-15:00.
 *   בית (אישית לכל משתמש, H = home, I = המשתמש): אפשר גם שעה.
 *     תאריך + שעה → בדיוק אז · שעה בלי תאריך → הפעם הבאה שהשעה מגיעה (התאריך נשמר) · תאריך בלי שעה → ערב לפני, 18:00.
 *     נוצרה אחרי שזמן ההתראה עבר → מסומנת מיד (אדום), בלי Push.
 *   מזהה | טקסט | תאריך | נוצר | עודכן | מצב | התראה נשלחה ל- | רשימה | משתמש | שעה
 * מחיקה ו"בוצע" לא מוחקים שורה – רק משנים מצב (כך ↶ יכול להחזיר).
 * רץ מתוך הבדיקה של כל דקה (גם בלילה – בדיקה זולה מהזיכרון) – בלי טריגר נוסף.
 */
const REM_TAB_ = { name: 'תזכורות (מערכת)', head: ['מזהה', 'טקסט', 'תאריך', 'נוצר', 'עודכן', 'מצב', 'התראה נשלחה ל-', 'רשימה', 'משתמש', 'שעה'] };
const REM_ACTIVE_ = 'פעיל', REM_DONE_ = 'בוצע', REM_DELETED_ = 'נמחק';
const REM_NEXT_KEY_ = 'REM_NEXT_V3';   // מתי ההתראה הקרובה (ms). שם חדש = הלוח מחושב מחדש פעם אחת לפי הכללים הנוכחיים
const REM_COLS_ = 10;

function remSheet_() {
  const ss = systemSs_();
  let sh = ss.getSheetByName(REM_TAB_.name);
  if (!sh) {
    sh = ss.insertSheet(REM_TAB_.name);
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.hideSheet();
  }
  if (sh.getRange(1, REM_COLS_).getValue() !== REM_TAB_.head[REM_COLS_ - 1]) {
    sh.getRange(1, 1, 1, REM_COLS_).setValues([REM_TAB_.head]).setFontWeight('bold');
  }
  return sh;
}
function remRows_() {
  const sh = remSheet_();
  const n = sh.getLastRow();
  const rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, REM_COLS_).getDisplayValues();
  return { sh: sh, list: rows.map(function (r, i) {
    return { row: i + 2, id: r[0], text: r[1], date: r[2], created: Number(r[3]) || 0, updated: Number(r[4]) || 0, status: r[5] || REM_ACTIVE_,
      notified: r[6], list: r[7] === 'home' ? 'home' : '', owner: String(r[8] || '').toLowerCase(), time: r[9] || '' };
  }) };
}
/** המפתח של "התראה נשלחה": תאריך (+ שעה). שינוי תאריך/שעה = מפתח חדש = ההתראה מתוזמנת מחדש */
function remKey_(x) { return x.date ? x.date + (x.time ? ' ' + x.time : '') : ''; }
// alerted = כבר נשלחה (או עבר הזמן) – השורה אדומה עד ✓ / מחיקה / מועד חדש
function remPublic_(x) {
  const f = remFireAt_(x);
  return { id: x.id, text: x.text, date: x.date, time: x.time, created: x.created, fireAt: f ? f.getTime() : null, alerted: !!x.date && x.notified === remKey_(x) };
}
function remWrite_(sh, x) {
  sh.getRange(x.row, 1, 1, REM_COLS_).setValues([[x.id, x.text, x.date || '', String(x.created || ''), String(Date.now()), x.status, x.notified || '',
    x.list || '', x.owner || '', x.time || '']]);
}
/** list: '' = פיננסים, 'home' = הבית של המשתמש */
function remList_(list, email) {
  return remRows_().list.filter(function (x) {
    return x.status === REM_ACTIVE_ && x.list === (list || '') && (!list || x.owner === String(email || '').toLowerCase());
  }).map(remPublic_);
}

/** רק מצב התזכורת – למחסנית ↶/↷ */
function remState_(x) { return x ? { text: x.text, date: x.date || '', time: x.time || '', status: x.status } : null; }

function cleanRemDate_(d) {
  d = String(d || '').trim();
  if (!d) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw apiError_('BAD_REQUEST', 'תאריך לא תקין');
  return d;
}
function cleanRemTime_(t) {
  t = String(t || '').trim();
  if (!t) return '';
  if (!/^\d{2}:\d{2}$/.test(t)) throw apiError_('BAD_REQUEST', 'שעה לא תקינה');
  return t;
}
function remCanTouch_(x, ctx) { return x.list !== 'home' || x.owner === ctx.email; }

// ---------- פעולות (דרך התור, פעם אחת לכל opId – ראו OP_ONCE_) ----------
/** הוספה (בלי id) או עריכה */
function actionReminderSave_(req, ctx) {
  const text = String(req.text || '').trim().slice(0, 500);
  if (!text) throw apiError_('BAD_REQUEST', 'חסר טקסט לתזכורת');
  const list = req.list === 'home' ? 'home' : '';
  let date = cleanRemDate_(req.date);
  const time = list === 'home' ? cleanRemTime_(req.time) : '';
  // שעה בלי תאריך: הפעם הבאה שהשעה הזו מגיעה (היום אם עוד לא עברה, אחרת מחר)
  if (time && !date) {
    const today = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
    date = parseIsoTz_(today + 'T' + time + ':00').getTime() > Date.now() ? today
      : Utilities.formatDate(new Date(Date.now() + DAY_MS_), TZ_, 'yyyy-MM-dd');
  }
  let out = null;
  withLock_(function () {
    CACHE_PATCH_ = 'skip';
    const d = remRows_();
    let x = req.id ? d.list.filter(function (r) { return r.id === req.id; })[0] : null;
    if (req.id && (!x || !remCanTouch_(x, ctx))) throw apiError_('NOT_FOUND', 'התזכורת לא נמצאה');
    const before = remState_(x);
    if (!x) x = { row: d.sh.getLastRow() + 1, id: String(req.newId || Utilities.getUuid().slice(0, 10)), created: Date.now(), status: REM_ACTIVE_, notified: '',
      list: list, owner: list === 'home' ? ctx.email : '' };
    x.text = text; x.date = date; x.time = time; x.status = REM_ACTIVE_;
    // בבית: אם זמן ההתראה כבר עבר – מסומנת מיד (אדום), בלי Push
    const f = remFireAt_(x);
    if (x.list === 'home' && f && f.getTime() <= Date.now()) x.notified = remKey_(x);
    remWrite_(d.sh, x);
    pushUndoEntry_(ctx.email, { kind: 'rem', id: x.id, before: before, after: remState_(x), desc: before ? 'עריכת תזכורת' : 'תזכורת חדשה', changes: [] });
    out = { reminder: remPublic_(x) };
  });
  remSchedule_();   // פיננסים: אם זמן ההתראה כבר עבר – נשלחת עכשיו
  const fresh = remRows_().list.filter(function (r) { return r.id === out.reminder.id; })[0];
  if (fresh) out.reminder = remPublic_(fresh);
  return Object.assign(out, { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) });
}

/** בוצע / מחיקה – משנה מצב בלבד */
function actionReminderSet_(req, ctx) {
  const status = req.op === 'done' ? REM_DONE_ : req.op === 'delete' ? REM_DELETED_ : '';
  if (!status) throw apiError_('BAD_REQUEST', 'פעולה לא מוכרת');
  withLock_(function () {
    CACHE_PATCH_ = 'skip';
    const d = remRows_();
    const x = d.list.filter(function (r) { return r.id === req.id; })[0];
    if (!x || !remCanTouch_(x, ctx)) throw apiError_('NOT_FOUND', 'התזכורת לא נמצאה');
    const before = remState_(x);
    x.status = status;
    remWrite_(d.sh, x);
    pushUndoEntry_(ctx.email, { kind: 'rem', id: x.id, before: before, after: remState_(x), desc: status === REM_DONE_ ? 'תזכורת בוצעה' : 'מחיקת תזכורת', changes: [] });
  });
  remSchedule_();
  return { ok: true, undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) };
}

/** ↶/↷ (מתוך undoRedo_, בתוך הנעילה): מחזיר את התזכורת למצב ששמור ברשומה */
function remUndoRedo_(e, to, verb, ctx) {
  const d = remRows_();
  const x = d.list.filter(function (r) { return r.id === e.id; })[0];
  if (!x || !remCanTouch_(x, ctx)) return { done: false, message: 'התזכורת לא נמצאה' };
  const cur = remState_(x);
  const target = e.before || { text: x.text, date: x.date, time: x.time, status: REM_DELETED_ };   // לפני ההוספה = לא קיימת
  x.text = target.text; x.date = target.date; x.time = target.time || ''; x.status = target.status;
  remWrite_(d.sh, x);
  pushStack_(to, ctx.email, { kind: 'rem', id: e.id, before: cur, after: target, desc: e.desc, changes: [] });
  remSchedule_(true);   // בתוך הנעילה – ההתראה (אם הגיע זמנה) תצא בבדיקה של הדקה הבאה
  return { done: true, message: verb + ': ' + (e.desc || 'תזכורת'), rem: true, reminder: target.status === REM_ACTIVE_ ? remPublic_(x) : null, remId: e.id };
}

// ---------- התראות ----------
/** מתי לשלוח (שעון ישראל). אין תאריך → אין התראה. */
function remFireAt_(x) {
  if (!x.date) return null;
  if (x.list === 'home' && x.time) return parseIsoTz_(x.date + 'T' + x.time + ':00');
  const p = x.date.split('-').map(Number);
  const iso = Utilities.formatDate(new Date(p[0], p[1] - 1, p[2] - 1), TZ_, 'yyyy-MM-dd');
  return parseIsoTz_(iso + (x.list === 'home' ? 'T18:00:00' : 'T15:00:00'));
}
function parseIsoTz_(s) {
  // תאריך+שעה בשעון ישראל → Date (בלי תלות באזור הזמן של השרת)
  const off = Utilities.formatDate(new Date(s + 'Z'), TZ_, 'Z');   // למשל +0300
  return new Date(s + off.slice(0, 3) + ':' + off.slice(3));
}
function remSetNext_(next) {
  PropertiesService.getScriptProperties().setProperty(REM_NEXT_KEY_, String(next));
  try { CacheService.getScriptCache().put('rem_next', String(next), 21600); } catch (e) { /* */ }
}
/** מחשב מחדש מתי ההתראה הקרובה (נקרא אחרי כל שינוי) */
function remSchedule_(noSend) {
  let next = 0;
  remRows_().list.forEach(function (x) {
    if (x.status !== REM_ACTIVE_ || !x.date || x.notified === remKey_(x)) return;
    const t = remFireAt_(x).getTime();
    if (!next || t < next) next = t;
  });
  remSetNext_(next);
  if (!noSend && next && next <= Date.now()) { try { remNotifyDue_(); } catch (e) { console.warn('rem: ' + e); } }   // הגיע הזמן כבר – מיד
}
/** מתוך הבדיקה של כל דקה – גם בלילה. קודם מהזיכרון (זול), ורק אם הגיע זמן – קורא את הגיליון. */
function remWatch_() {
  let raw = null;
  try { raw = CacheService.getScriptCache().get('rem_next'); } catch (e) { /* */ }
  if (raw === null) {
    raw = PropertiesService.getScriptProperties().getProperty(REM_NEXT_KEY_);
    if (raw === null) { remSchedule_(); return; }   // עוד לא חושב לפי הכללים הנוכחיים
    try { CacheService.getScriptCache().put('rem_next', raw, 21600); } catch (e) { /* */ }
  }
  const next = Number(raw || 0);
  if (!next || next > Date.now()) return;
  remNotifyDue_();
}
function remNotifyDue_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  let next = 0;
  try {
    const d = remRows_();
    const today = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
    const tomorrow = Utilities.formatDate(new Date(Date.now() + DAY_MS_), TZ_, 'yyyy-MM-dd');
    d.list.forEach(function (x) {
      if (x.status !== REM_ACTIVE_ || !x.date || x.notified === remKey_(x)) return;
      const t = remFireAt_(x).getTime();
      if (t > Date.now()) { if (!next || t < next) next = t; return; }
      const when = x.date === tomorrow ? 'למחר' : x.date === today ? 'להיום' : 'מ-' + x.date.split('-').reverse().slice(0, 2).join('/');
      if (x.list === 'home') {
        // שעה שנבחרה – עוקפת שעות שקט (סוג reminder לא מושהה). תאריך בלי שעה – ערב לפני.
        notify_('reminder', { title: '⏰ ' + (x.time ? 'תזכורת' : 'תזכורת ' + when) + ': ' + String(x.text).slice(0, 140), link: '#/home' }, { only: x.owner });
      } else {
        notify_('reminder', { title: '⏰ תזכורת ' + when + ': ' + String(x.text).slice(0, 140), link: '#/finance' });
      }
      x.notified = remKey_(x);
      d.sh.getRange(x.row, 7).setValue(x.notified);
    });
  } finally { lock.releaseLock(); }
  remSetNext_(next);
}
