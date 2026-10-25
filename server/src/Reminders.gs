/**
 * תזכורות (ליאל בלבד) – בסקשן "תזכורות" במסך הפיננסים.
 * נשמר בלשונית מוסתרת "תזכורות (מערכת)" בגיליון המערכת של האפליקציה. לא נוגעים בשום לשונית קיימת.
 *   מזהה | טקסט | תאריך (yyyy-MM-dd) | נוצר | עודכן | מצב (פעיל / בוצע / נמחק) | התראה נשלחה לתאריך
 * מחיקה ו"בוצע" לא מוחקים שורה – רק משנים מצב (כך ↶ יכול להחזיר).
 * התראה: יום לפני התאריך ב-18:00 (או מיד, אם השעה הזו כבר עברה), פעם אחת לכל תאריך.
 * רץ מתוך הבדיקה של כל דקה (watchNewLeads) – בלי טריגר נוסף. קריאה מהגיליון רק כשמגיע זמן של תזכורת.
 */
const REM_TAB_ = { name: 'תזכורות (מערכת)', head: ['מזהה', 'טקסט', 'תאריך', 'נוצר', 'עודכן', 'מצב', 'התראה נשלחה לתאריך'] };
const REM_ACTIVE_ = 'פעיל', REM_DONE_ = 'בוצע', REM_DELETED_ = 'נמחק';
const REM_NEXT_KEY_ = 'REM_NEXT';   // מתי ההתראה הקרובה (ms) – כדי לא לקרוא את הגיליון כל דקה

function remSheet_() {
  const ss = systemSs_();
  let sh = ss.getSheetByName(REM_TAB_.name);
  if (!sh) {
    sh = ss.insertSheet(REM_TAB_.name);
    sh.getRange(1, 1, 1, REM_TAB_.head.length).setValues([REM_TAB_.head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}
function remRows_() {
  const sh = remSheet_();
  const n = sh.getLastRow();
  const rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, REM_TAB_.head.length).getDisplayValues();
  return { sh: sh, list: rows.map(function (r, i) {
    return { row: i + 2, id: r[0], text: r[1], date: r[2], created: Number(r[3]) || 0, updated: Number(r[4]) || 0, status: r[5] || REM_ACTIVE_, notified: r[6] };
  }) };
}
function remPublic_(x) { return { id: x.id, text: x.text, date: x.date, created: x.created }; }
function remWrite_(sh, x) {
  sh.getRange(x.row, 1, 1, 7).setValues([[x.id, x.text, x.date || '', String(x.created || ''), String(Date.now()), x.status, x.notified || '']]);
}
function remList_() {
  return remRows_().list.filter(function (x) { return x.status === REM_ACTIVE_; }).map(remPublic_);
}

/** רק מצב התזכורת (טקסט / תאריך / מצב) – למחסנית ↶/↷ */
function remState_(x) { return x ? { text: x.text, date: x.date || '', status: x.status } : null; }

function cleanRemDate_(d) {
  d = String(d || '').trim();
  if (!d) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw apiError_('BAD_REQUEST', 'תאריך לא תקין');
  return d;
}

// ---------- פעולות (דרך התור, פעם אחת לכל opId – ראו OP_ONCE_) ----------
/** הוספה (בלי id) או עריכה */
function actionReminderSave_(req, ctx) {
  const text = String(req.text || '').trim().slice(0, 500);
  if (!text) throw apiError_('BAD_REQUEST', 'חסר טקסט לתזכורת');
  const date = cleanRemDate_(req.date);
  let out = null;
  withLock_(function () {
    CACHE_PATCH_ = 'skip';
    const d = remRows_();
    let x = req.id ? d.list.filter(function (r) { return r.id === req.id; })[0] : null;
    if (req.id && !x) throw apiError_('NOT_FOUND', 'התזכורת לא נמצאה');
    const before = remState_(x);
    if (!x) x = { row: d.sh.getLastRow() + 1, id: String(req.newId || Utilities.getUuid().slice(0, 10)), created: Date.now(), status: REM_ACTIVE_, notified: '' };
    x.text = text; x.date = date; x.status = REM_ACTIVE_;
    remWrite_(d.sh, x);
    pushUndoEntry_(ctx.email, { kind: 'rem', id: x.id, before: before, after: remState_(x), desc: before ? 'עריכת תזכורת' : 'תזכורת חדשה', changes: [] });
    out = { reminder: remPublic_(x) };
  });
  remSchedule_();
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
    if (!x) throw apiError_('NOT_FOUND', 'התזכורת לא נמצאה');
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
  if (!x) return { done: false, message: 'התזכורת לא נמצאה' };
  const cur = remState_(x);
  const target = e.before || { text: x.text, date: x.date, status: REM_DELETED_ };   // לפני ההוספה = לא קיימת
  x.text = target.text; x.date = target.date; x.status = target.status;
  remWrite_(d.sh, x);
  pushStack_(to, ctx.email, { kind: 'rem', id: e.id, before: cur, after: target, desc: e.desc, changes: [] });
  remSchedule_(true);   // בתוך הנעילה – ההתראה (אם הגיע זמנה) תצא בבדיקה של הדקה הבאה
  return { done: true, message: verb + ': ' + (e.desc || 'תזכורת'), rem: true, reminder: target.status === REM_ACTIVE_ ? remPublic_(x) : null, remId: e.id };
}

// ---------- התראות ----------
/** מתי לשלוח: יום לפני, 18:00 (שעון ישראל) */
function remFireAt_(date) {
  const p = date.split('-').map(Number);
  const dayBefore = new Date(p[0], p[1] - 1, p[2] - 1);
  const iso = Utilities.formatDate(dayBefore, TZ_, 'yyyy-MM-dd');
  return parseIsoTz_(iso + 'T18:00:00');
}
function parseIsoTz_(s) {
  // תאריך+שעה בשעון ישראל → Date (בלי תלות באזור הזמן של השרת)
  const off = Utilities.formatDate(new Date(s + 'Z'), TZ_, 'Z');   // למשל +0300
  return new Date(s + off.slice(0, 3) + ':' + off.slice(3));
}
/** מחשב מחדש מתי ההתראה הקרובה (נקרא אחרי כל שינוי) */
function remSchedule_(noSend) {
  let next = 0;
  remRows_().list.forEach(function (x) {
    if (x.status !== REM_ACTIVE_ || !x.date || x.notified === x.date) return;
    const t = remFireAt_(x.date).getTime();
    if (!next || t < next) next = t;
  });
  PropertiesService.getScriptProperties().setProperty(REM_NEXT_KEY_, String(next));
  if (!noSend && next && next <= Date.now()) { try { remNotifyDue_(); } catch (e) { console.warn('rem: ' + e); } }   // הגיע הזמן כבר – מיד
}
/** מתוך הבדיקה של כל דקה */
function remWatch_() {
  const next = Number(PropertiesService.getScriptProperties().getProperty(REM_NEXT_KEY_) || 0);
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
      if (x.status !== REM_ACTIVE_ || !x.date || x.notified === x.date) return;
      const t = remFireAt_(x.date).getTime();
      if (t > Date.now()) { if (!next || t < next) next = t; return; }
      const when = x.date === tomorrow ? 'למחר' : x.date === today ? 'להיום' : 'מ-' + x.date.split('-').reverse().slice(0, 2).join('/');
      notify_('reminder', { title: '⏰ תזכורת ' + when + ': ' + String(x.text).slice(0, 140), link: '#/finance' });
      x.notified = x.date;
      d.sh.getRange(x.row, 7).setValue(x.date);
    });
  } finally { lock.releaseLock(); }
  PropertiesService.getScriptProperties().setProperty(REM_NEXT_KEY_, String(next));
}
