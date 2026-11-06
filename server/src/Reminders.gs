/**
 * תזכורות – שתי רשימות באותה לשונית מוסתרת "תזכורות (מערכת)" בגיליון המערכת של האפליקציה:
 *   פיננסים (ליאל): עמודה H ריקה. התראה יום לפני ב-15:00.
 *   בית (אישית לכל משתמש, H = home, I = המשתמש): אפשר גם שעה.
 *     תאריך + שעה → בדיוק אז · שעה בלי תאריך → הפעם הבאה שהשעה מגיעה (התאריך נשמר) · תאריך בלי שעה → ערב לפני, 18:00.
 *     נוצרה אחרי שזמן ההתראה עבר → מסומנת מיד (אדום), בלי Push.
 *   מזהה | טקסט | תאריך | נוצר | עודכן | מצב | התראה נשלחה ל- | רשימה | משתמש | שעה | קטגוריה
 *   קטגוריה (K, נוסף 06/11/2026): ריק = ברירת המחדל ("תזכורות"). הקטגוריות עצמן – בלשונית "קטגוריות תזכורות (מערכת)".
 * מחיקה ו"בוצע" לא מוחקים שורה – רק משנים מצב (כך ↶ יכול להחזיר).
 * רץ מתוך הבדיקה של כל דקה (גם בלילה – בדיקה זולה מהזיכרון) – בלי טריגר נוסף.
 */
const REM_TAB_ = { name: 'תזכורות (מערכת)', head: ['מזהה', 'טקסט', 'תאריך', 'נוצר', 'עודכן', 'מצב', 'התראה נשלחה ל-', 'רשימה', 'משתמש', 'שעה', 'קטגוריה'] };
const REM_ACTIVE_ = 'פעיל', REM_DONE_ = 'בוצע', REM_DELETED_ = 'נמחק';
const REM_NEXT_KEY_ = 'REM_NEXT_V3';   // מתי ההתראה הקרובה (ms). שם חדש = הלוח מחושב מחדש פעם אחת לפי הכללים הנוכחיים
const REM_COLS_ = 11;

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
      notified: r[6], list: r[7] === 'home' ? 'home' : '', owner: String(r[8] || '').toLowerCase(), time: r[9] || '', cat: r[10] || '' };
  }) };
}
/** המפתח של "התראה נשלחה": תאריך (+ שעה). שינוי תאריך/שעה = מפתח חדש = ההתראה מתוזמנת מחדש */
function remKey_(x) { return x.date ? x.date + (x.time ? ' ' + x.time : '') : ''; }
// alerted = כבר נשלחה (או עבר הזמן) – השורה אדומה עד ✓ / מחיקה / מועד חדש
function remPublic_(x) {
  const f = remFireAt_(x);
  return { id: x.id, text: x.text, date: x.date, time: x.time, cat: x.cat || '', created: x.created, fireAt: f ? f.getTime() : null, alerted: !!x.date && x.notified === remKey_(x) };
}
function remWrite_(sh, x) {
  sh.getRange(x.row, 1, 1, REM_COLS_).setValues([[x.id, x.text, x.date || '', String(x.created || ''), String(Date.now()), x.status, x.notified || '',
    x.list || '', x.owner || '', x.time || '', x.cat || '']]);
}
/** list: '' = פיננסים, 'home' = הבית של המשתמש */
function remList_(list, email) {
  // מזהה כפול: רק השורה האחרונה שעודכנה קובעת (כך שורה ישנה שנשארה "פעיל" לא מחזירה תזכורת שנמחקה)
  const byId = {};
  remRows_().list.forEach(function (x) { if (!byId[x.id] || x.updated >= byId[x.id].updated) byId[x.id] = x; });
  return Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (x) {
    return x.status === REM_ACTIVE_ && x.list === (list || '') && (!list || x.owner === String(email || '').toLowerCase());
  }).map(remPublic_);
}

/** רק מצב התזכורת – למחסנית ↶/↷ */
function remState_(x) { return x ? { text: x.text, date: x.date || '', time: x.time || '', status: x.status, cat: x.cat || '' } : null; }
/** מזהה קטגוריה: ריק / default = ברירת המחדל */
function cleanRemCat_(c) {
  c = String(c == null ? '' : c).trim();
  if (!c || c === 'default') return '';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(c)) throw apiError_('BAD_REQUEST', 'קטגוריה לא תקינה');
  return c;
}

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
/** כל השורות עם המזהה (אמורה להיות אחת – אבל אם נוצרה כפילות, כל פעולה חלה על כולן) */
function remAllById_(d, id) { return d.list.filter(function (r) { return r.id === id; }); }
/** השורה "הקובעת" למזהה: זו שעודכנה אחרונה */
function remLatest_(rows) { return rows.slice().sort(function (a, b) { return b.updated - a.updated; })[0] || null; }
/** מתי הפעולה נוצרה במכשיר (מתוך opId: זמן בבסיס 36 לפני המקף) */
function remOpTime_(req) { const t = parseInt(String((req && req.opId) || '').split('-')[0], 36); return t > 1.7e12 && t < 4e12 ? t : 0; }
// פעולת שמירה ישנה (שליחה חוזרת מהתור אחרי שעות) לא דורסת שינוי מאוחר יותר. מרווח לסטיית שעון של המכשיר.
const REM_STALE_MS_ = 120000;

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
    // הוספה שכבר קרתה (אותו newId) – למשל שליחה חוזרת מהתור אחרי יותר מ-6 שעות: לא יוצרים שורה שנייה, לא משנים כלום
    const dupNew = !req.id && req.newId ? remLatest_(remAllById_(d, String(req.newId))) : null;
    if (dupNew) { out = { duplicate: true, reminder: dupNew.status === REM_ACTIVE_ ? remPublic_(dupNew) : null }; return; }
    const rows = req.id ? remAllById_(d, req.id).filter(function (r) { return remCanTouch_(r, ctx); }) : [];
    let x = remLatest_(rows);
    if (req.id && !x) throw apiError_('NOT_FOUND', 'התזכורת לא נמצאה');
    // עריכה ישנה (נוצרה לפני השינוי האחרון בשורה) – לא דורסת (למשל לא מחזירה תזכורת שנמחקה)
    const opT = remOpTime_(req);
    if (x && opT && opT < x.updated - REM_STALE_MS_) { out = { duplicate: true, stale: true, reminder: x.status === REM_ACTIVE_ ? remPublic_(x) : null }; return; }
    const before = remState_(x);
    if (!x) x = { row: d.sh.getLastRow() + 1, id: String(req.newId || Utilities.getUuid().slice(0, 10)), created: Date.now(), status: REM_ACTIVE_, notified: '',
      list: list, owner: list === 'home' ? ctx.email : '' };
    x.text = text; x.date = date; x.time = time; x.status = REM_ACTIVE_;
    if (list === 'home' && req.cat !== undefined) x.cat = cleanRemCat_(req.cat);   // לא נשלח = הקטגוריה לא משתנה
    // בבית: אם זמן ההתראה כבר עבר – מסומנת מיד (אדום), בלי Push
    const f = remFireAt_(x);
    if (x.list === 'home' && f && f.getTime() <= Date.now()) x.notified = remKey_(x);
    remWrite_(d.sh, x);
    rows.forEach(function (r) { if (r.row !== x.row) { r.status = REM_DELETED_; remWrite_(d.sh, r); } });   // כפילות ישנה – יורדת
    pushUndoEntry_(ctx.email, { kind: 'rem', id: x.id, before: before, after: remState_(x), desc: before ? 'עריכת תזכורת' : 'תזכורת חדשה', changes: [] });
    out = { reminder: remPublic_(x) };
  });
  if (out.duplicate) return Object.assign(out, { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) });
  remSchedule_();   // פיננסים: אם זמן ההתראה כבר עבר – נשלחת עכשיו
  const fresh = remLatest_(remAllById_(remRows_(), out.reminder.id));
  if (fresh) out.reminder = remPublic_(fresh);
  return Object.assign(out, { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) });
}

/** בוצע / מחיקה – משנה מצב בלבד. תמיד מצליחה: בכל השורות עם המזהה, גם אם ההתראה יצאה או שהשורה השתנתה מאז שנטענה */
function actionReminderSet_(req, ctx) {
  const status = req.op === 'done' ? REM_DONE_ : req.op === 'delete' ? REM_DELETED_ : '';
  if (!status) throw apiError_('BAD_REQUEST', 'פעולה לא מוכרת');
  withLock_(function () {
    CACHE_PATCH_ = 'skip';
    const d = remRows_();
    const rows = remAllById_(d, String(req.id || '')).filter(function (r) { return remCanTouch_(r, ctx); });
    if (!rows.length) return;   // כבר לא קיימת – המטרה הושגה
    const x = remLatest_(rows.filter(function (r) { return r.status === REM_ACTIVE_; }));
    if (!x) return;   // כבר ירדה (שליחה חוזרת)
    const before = remState_(x);
    rows.forEach(function (r) { if (r.status === REM_ACTIVE_) { r.status = status; remWrite_(d.sh, r); } });
    pushUndoEntry_(ctx.email, { kind: 'rem', id: x.id, before: before, after: remState_(x), desc: status === REM_DONE_ ? 'תזכורת בוצעה' : 'מחיקת תזכורת', changes: [] });
  });
  remSchedule_();
  return { ok: true, undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) };
}

/** ↶/↷ (מתוך undoRedo_, בתוך הנעילה): מחזיר את התזכורת למצב ששמור ברשומה */
function remUndoRedo_(e, to, verb, ctx) {
  const d = remRows_();
  const rows = remAllById_(d, e.id).filter(function (r) { return remCanTouch_(r, ctx); });
  const x = remLatest_(rows);
  if (!x) return { done: false, message: 'התזכורת לא נמצאה' };
  const cur = remState_(x);
  const target = e.before || { text: x.text, date: x.date, time: x.time, status: REM_DELETED_ };   // לפני ההוספה = לא קיימת
  x.text = target.text; x.date = target.date; x.time = target.time || ''; x.status = target.status;
  if (target.cat != null) x.cat = target.cat;   // רשומות ישנות (לפני הקטגוריות) – הקטגוריה לא משתנה
  remWrite_(d.sh, x);
  rows.forEach(function (r) { if (r.row !== x.row && r.status === REM_ACTIVE_) { r.status = REM_DELETED_; remWrite_(d.sh, r); } });
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


// ---------- קטגוריות של תזכורות בבית (לכל משתמש בנפרד) – נוסף 06/11/2026 ----------
// לשונית מוסתרת "קטגוריות תזכורות (מערכת)": מזהה | שם | צבע | סדר | משתמש | עודכן | מצב
// ברירת המחדל ("תזכורות", כחולה) לא חייבת שורה; שורה עם המזהה default משנה לה שם / צבע. מחיקה = מצב "נמחק" (השורה נשארת).
const REM_CAT_TAB_ = { name: 'קטגוריות תזכורות (מערכת)', head: ['מזהה', 'שם', 'צבע', 'סדר', 'משתמש', 'עודכן', 'מצב'] };
const REM_CAT_COLORS_ = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'gray', 'beige'];
function remCatSheet_() {
  const ss = systemSs_();
  let sh = ss.getSheetByName(REM_CAT_TAB_.name);
  if (!sh) {
    sh = ss.insertSheet(REM_CAT_TAB_.name);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.getRange(1, 1, 1, REM_CAT_TAB_.head.length).setValues([REM_CAT_TAB_.head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}
function remCatRows_(create) {
  const ss = systemSs_();
  const sh = create ? remCatSheet_() : ss.getSheetByName(REM_CAT_TAB_.name);
  if (!sh) return { sh: null, list: [] };
  const n = sh.getLastRow();
  const rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, 7).getDisplayValues();
  return { sh: sh, list: rows.map(function (r, i) {
    return { row: i + 2, id: r[0], name: r[1], color: r[2], order: Number(r[3]) || 0, owner: String(r[4] || '').toLowerCase(), updated: Number(r[5]) || 0, status: r[6] || REM_ACTIVE_ };
  }) };
}
function remCatWrite_(sh, c) {
  sh.getRange(c.row, 1, 1, 7).setValues([[c.id, c.name, c.color, String(c.order || 0), c.owner, String(Date.now()), c.status]]);
}
/** הקטגוריות של המשתמש (שורה אחרונה לכל מזהה), כולל default אם שונה לה שם / צבע */
function remCatList_(email) {
  const me = String(email || '').toLowerCase();
  const byId = {};
  remCatRows_(false).list.forEach(function (c) { if (c.owner === me && (!byId[c.id] || c.updated >= byId[c.id].updated)) byId[c.id] = c; });
  return Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (c) { return c.status === REM_ACTIVE_; })
    .map(function (c) { return { id: c.id, name: c.name, color: c.color, order: c.order }; });
}
/** הוספה (newId) או שינוי שם / צבע / סדר (id). default = ברירת המחדל */
function actionRemCatSave_(req, ctx) {
  const id = String(req.id || req.newId || '').trim();
  if (id !== 'default') cleanRemCat_(id);
  if (!id) throw apiError_('BAD_REQUEST', 'חסר מזהה');
  const name = String(req.name || '').trim().slice(0, 40);
  if (!name) throw apiError_('BAD_REQUEST', 'חסר שם לקטגוריה');
  const color = REM_CAT_COLORS_.indexOf(req.color) >= 0 ? req.color : 'blue';
  let out = null;
  withLock_(function () {
    CACHE_PATCH_ = 'skip';
    const d = remCatRows_(true);
    const mine = d.list.filter(function (c) { return c.id === id && c.owner === ctx.email; });
    let c = mine.sort(function (a, b) { return b.updated - a.updated; })[0];
    if (!c) c = { row: d.sh.getLastRow() + 1, id: id, owner: ctx.email, order: Number(req.order) || Date.now() };
    else if (req.order != null) c.order = Number(req.order) || c.order;
    c.name = name; c.color = color; c.status = REM_ACTIVE_;
    remCatWrite_(d.sh, c);
    out = { cat: { id: c.id, name: c.name, color: c.color, order: c.order } };
  });
  return out;
}
/** מחיקת קטגוריה: התזכורות שבה עוברות לברירת המחדל (אף תזכורת לא נמחקת) */
function actionRemCatDelete_(req, ctx) {
  const id = cleanRemCat_(req.id);
  if (!id) throw apiError_('BAD_REQUEST', 'אי אפשר למחוק את ברירת המחדל');
  let moved = 0;
  withLock_(function () {
    CACHE_PATCH_ = 'skip';
    const d = remCatRows_(false);
    if (d.sh) d.list.forEach(function (c) { if (c.id === id && c.owner === ctx.email && c.status === REM_ACTIVE_) { c.status = REM_DELETED_; remCatWrite_(d.sh, c); } });
    const r = remRows_();
    r.list.forEach(function (x) {
      if (x.list === 'home' && x.owner === ctx.email && x.cat === id) { x.cat = ''; remWrite_(r.sh, x); moved++; }
    });
  });
  return { ok: true, moved: moved };
}
