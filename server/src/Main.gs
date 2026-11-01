/**
 * Liel Fitness – API לאפליקציה.
 * פרויקט נפרד: לא נוגע בסקריפטים הקיימים, רק קורא/כותב לגיליונות לפי ID.
 *
 * Script Properties (ליאל מכניס ידנית):
 *   TELEGRAM_BOT_TOKEN  טוקן הבוט הקיים (סוד – רק כאן)
 *   CONFIG (לא חובה)    JSON שגובר על LocalConfig.gs
 * הגדרות שאינן סוד: LocalConfig.gs (בפרויקט בלבד, לא בריפו הציבורי)
 * נוצר אוטומטית ע"י setup(): SESSION_SECRET
 */

// אילו תפקידים רשאים לכל פעולה. נאכף כאן, בשרת.
const ACTIONS = {
  me:           { roles: ['admin', 'leads'], fn: actionMe_ },
  listLeads:    { roles: ['admin', 'leads'], fn: actionListLeads_ },
  updateLead:   { roles: ['admin', 'leads'], fn: actionUpdateLead_ },
  markAttempt:  { roles: ['admin', 'leads'], fn: actionMarkAttempt_ },
  listGhosting: { roles: ['admin', 'leads'], fn: actionListGhosting_ },
  month:        { roles: ['admin', 'leads'], fn: actionMonth_ },
  zoomAlerts:   { roles: ['admin', 'leads'], fn: actionZoomAlerts_ },
  assignZoom:   { roles: ['admin', 'leads'], fn: actionAssignZoom_ },
  dismissZoom:  { roles: ['admin', 'leads'], fn: actionDismissZoom_ },
  home:         { roles: ['admin'],          fn: actionHome_ },
  undo:         { roles: ['admin', 'leads'], fn: actionUndo_ },
  redo:         { roles: ['admin', 'leads'], fn: actionRedo_ },
  addLead:      { roles: ['admin', 'leads'], fn: actionAddLead_ },
  getLead:      { roles: ['admin', 'leads'], fn: actionGetLead_ },
  pendingBooking: { roles: ['admin', 'leads'], fn: actionPendingBooking_ },
  cancelZoom:   { roles: ['admin', 'leads'], fn: actionCancelZoom_ },
  deleteLead:   { roles: ['admin'],          fn: actionDeleteLead_ },
  undoCount:    { roles: ['admin', 'leads'], fn: actionUndoCount_ },
  batch:        { roles: ['admin', 'leads'], fn: actionBatch_ },
  perfLog:      { roles: ['admin'], fn: actionPerfLog_ },
  notifications:  { roles: ['admin', 'leads'], fn: actionNotifications_ },
  notifRead:      { roles: ['admin', 'leads'], fn: actionNotifRead_ },
  notifSeen:      { roles: ['admin', 'leads'], fn: actionNotifSeen_ },
  flushCaches:    { roles: ['admin', 'leads'], fn: actionFlushCaches_ },
  notifSettings:  { roles: ['admin', 'leads'], fn: actionNotifSettings_ },
  pushRegister:   { roles: ['admin', 'leads'], fn: actionPushRegister_ },
  pushUnregister: { roles: ['admin', 'leads'], fn: actionPushUnregister_ },
  pushTest:       { roles: ['admin', 'leads'], fn: actionPushTest_ },
  notifyTest:     { roles: ['admin'], fn: actionNotifyTest_ },
  // שלב 2 – ליאל בלבד
  coaches:        { roles: ['admin'], fn: actionCoaches_ },
  coach:          { roles: ['admin'], fn: actionCoach_ },
  lateCharge:     { roles: ['admin'], fn: actionLateCharge_ },
  coachRenew:     { roles: ['admin'], fn: actionCoachRenew_ },
  runMeetings:    { roles: ['admin'], fn: actionRunMeetings_ },
  finance:        { roles: ['admin'], fn: actionFinance_ },
  finDecide:      { roles: ['admin'], fn: actionFinDecide_ },
  finAddIncome:   { roles: ['admin'], fn: actionFinAddIncome_ },
  finAddExpense:  { roles: ['admin'], fn: actionFinAddExpense_ },
  finRemoveManual:{ roles: ['admin'], fn: actionFinRemoveManual_ },
  debtClear:      { roles: ['admin'], fn: actionDebtClear_ },
  lateClear:      { roles: ['admin'], fn: actionLateClear_ },
  gapClear:       { roles: ['admin'], fn: actionGapClear_ },
  coachAdd:       { roles: ['admin'], fn: actionCoachAdd_ },
  coachMinus:     { roles: ['admin'], fn: actionCoachMinus_ },
  anomClear:      { roles: ['admin'], fn: actionAnomClear_ },
  online:         { roles: ['admin'], fn: actionOnline_ },
  onboard:        { roles: ['admin'], fn: actionOnboard_ },
  onboardList:    { roles: ['admin'], fn: actionOnboardList_ },
  onboardRerun:   { roles: ['admin'], fn: actionOnboardRerun_ },
  reminderSave:   { roles: ['admin'], fn: actionReminderSave_ },
  reminderSet:    { roles: ['admin'], fn: actionReminderSet_ },
};

function doGet() {
  return ContentService.createTextOutput('Liel Fitness API');
}

function doPost(e) {
  const t0 = Date.now();
  let out;
  try {
    // Make שולח כטופס (key=value) – בטוח לשמות עם גרשיים; האפליקציה שולחת JSON
    const req = (e && e.parameter && e.parameter.action === 'notify') ? Object.assign({}, e.parameter)
      : JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handle_(req);
  } catch (err) {
    out = { ok: false, code: err.code || 'ERROR', error: String(err.message || err) };
    if (!err.code) console.error(err && err.stack || err);
  }
  out.ms = Date.now() - t0;
  try { logPerf_(e, out); } catch (err) { /* מדידה בלבד */ }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  const cfg = getConfig_();

  if (req.action === 'login') {
    const email = verifyIdToken_(req.idToken, cfg.clientId);
    const role = roleOf_(email, cfg);
    if (!role) throw apiError_('FORBIDDEN', 'למשתמש ' + email + ' אין הרשאה לאפליקציה');
    return { ok: true, session: makeSession_(email), email: email, role: role };
  }

  // התראה מסקריפט אחר (בלי התחברות, עם מפתח משלו)
  if (req.action === 'notify') return { ok: true, data: externalNotify_(req) };

  const email = checkSession_(req.session);
  const realRole = roleOf_(email, cfg);
  if (!realRole) throw apiError_('AUTH', 'אין הרשאה');

  // "תצוגה כמו שי": אדמין בלבד יכול לבקש לפעול בתפקיד leads – ואז חלות עליו בדיוק ההגבלות שלה
  let role = realRole;
  if (req.viewAs) {
    if (realRole !== 'admin') throw apiError_('FORBIDDEN', 'אין לך הרשאה לפעולה הזו');
    if (req.viewAs !== 'leads') throw apiError_('BAD_REQUEST', 'תצוגה לא מוכרת');
    role = 'leads';
  }

  const a = ACTIONS[req.action];
  if (!a) throw apiError_('BAD_REQUEST', 'פעולה לא מוכרת');
  if (a.roles.indexOf(role) < 0) throw apiError_('FORBIDDEN', 'אין לך הרשאה לפעולה הזו');

  const data = runAction_(req.action, req, { email: email, role: role, realRole: realRole, cfg: cfg });
  return { ok: true, data: data };
}

/** 🔄 באפליקציה = כמו כניסה מחדש: מוחקים את המטמון בשרת, כדי שכל מה שנטען אחר כך ייקרא מהגיליונות */
function actionFlushCaches_(req, ctx) {
  CacheService.getScriptCache().removeAll([LEADS_CACHE_KEY_, GHOST_CACHE_KEY_, 'coach_v1', 'finrev_v1', 'nl1:' + ctx.email, ONB_INFO_CACHE_]);
  return { ok: true };
}

function actionMe_(req, ctx) {
  return {
    email: ctx.email,
    role: ctx.role,
    realRole: ctx.realRole,
    bookingUrl: ctx.cfg.bookingUrl || '',
    bookingEmbedUrl: ctx.cfg.bookingEmbedUrl || '',
    undoCount: undoCount_(ctx.email),
    redoCount: redoCount_(ctx.email),
  };
}

function apiError_(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

let CONFIG_CACHE_ = null;
function getConfig_() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;
  const raw = PropertiesService.getScriptProperties().getProperty('CONFIG');
  const base = typeof LOCAL_CONFIG_ !== 'undefined' ? LOCAL_CONFIG_ : {};
  const cfg = Object.assign({}, base, raw ? JSON.parse(raw) : {});
  if (!cfg.leadsSheetId) throw apiError_('CONFIG', 'חסרות הגדרות (LocalConfig.gs / CONFIG)');
  const users = {};
  Object.keys(cfg.users || {}).forEach(function (k) { users[k.trim().toLowerCase()] = cfg.users[k]; });
  cfg.users = users;
  CONFIG_CACHE_ = cfg;
  return cfg;
}

function roleOf_(email, cfg) {
  const r = cfg.users[String(email || '').toLowerCase()];
  return (r === 'admin' || r === 'leads') ? r : null;
}

// ---------- מדידת זמני שמירה (לבדיקת מהירות) ----------
const PERF_ACTIONS_ = { updateLead: 1, markAttempt: 1, undo: 1, redo: 1, coachAdd: 1, coachMinus: 1,
  lateClear: 1, gapClear: 1, debtClear: 1, anomClear: 1, lateCharge: 1, coachRenew: 1, finDecide: 1,
  finAddIncome: 1, finAddExpense: 1, finRemoveManual: 1, online: 1, assignZoom: 1, dismissZoom: 1,
  addLead: 1, deleteLead: 1, cancelZoom: 1, pendingBooking: 1, runMeetings: 1, onboard: 1, onboardRerun: 1, reminderSave: 1, reminderSet: 1 };
function logPerf_(e, out) {
  const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const entry = function (p, ok, ms, via) {
    // מה נוגע: שדות, או המזהה / השם (למשל איזה ביטול נוקה)
    const what = p.fields ? Object.keys(p.fields).join(',') : (p.kind || [p.op, p.id, p.key, p.name, p.undo ? '↶' : ''].filter(Boolean).join(' ').slice(0, 120));
    return { t: Date.now(), a: p.action + (via ? ' (' + via + ')' : ''), ms: ms, v: req.v || '', ok: ok, f: what,
      ph: (p.opId ? 'op ' + p.opId + ' · ' : '') + (!via && !ok && out.error ? 'שגיאה: ' + out.error + ' · ' : '') + (!via && PHASES_ ? PHASES_.join(' · ') : '') +
        (!via && OPLOG_MS_ ? ' · oplog ' + OPLOG_MS_ : '') + (!via && ONCE_LOCK_MS_ != null ? ' · oplock ' + ONCE_LOCK_MS_ : '') +
        (!via && OPREWRITE_ ? ' · oprewrite ' + OPREWRITE_ : '') + (!via && !ok && out.code === 'BUSY' ? ' · BUSY' : '') +
        (!via && ok && out.data && out.data.running ? ' · RUNNING' : ''),
      lt: p._lt != null ? p._lt : '', qw: p._qw != null ? p._qw : '' };
  };
  let add = [];
  if (PERF_ACTIONS_[req.action]) add.push(entry(req, !!out.ok, out.ms, ''));
  // שמירות שנשלחו מהתור (ביציאה מהאפליקציה / בפתיחה מחדש) – שורה לכל שמירה. הזמן הוא של כל הבקשה.
  if (req.action === 'batch') {
    const res = (out.data && out.data.results) || [];
    (req.ops || []).slice(0, 40).forEach(function (op, i) {
      const p = Object.assign({}, op.params || {}, { action: op.action });
      if (!PERF_ACTIONS_[op.action]) return;
      const en = entry(p, !!out.ok && !!(res[i] && res[i].ok), out.ms, 'תור, ' + (i + 1) + '/' + req.ops.length);
      if (res[i] && res[i].code === 'BUSY') en.ph += 'BUSY';   // לספירה בדוח
      if (res[i] && res[i].ok && res[i].data && res[i].data.running) en.ph += 'RUNNING';
      add.push(en);
    });
  }
  if (!add.length) return;
  // נעילה קצרה למשתמש: שתי בקשות במקביל לא ימחקו זו לזו את הרישום
  const lock = LockService.getUserLock();
  const got = lock.tryLock(3000);
  try {
    const cache = CacheService.getScriptCache();
    const log = JSON.parse(cache.get('perf_buf') || '[]').concat(add);
    cache.put('perf_buf', JSON.stringify(log.slice(-80)), 21600);
  } finally { if (got) lock.releaseLock(); }
}
/** מתוך הבדיקה של כל דקה: מעביר את המדידות ללשונית "ביצועים" בגיליון המערכת (כדי שאפשר לקרוא אותן) */
function flushPerf_() {
  const cache = CacheService.getScriptCache();
  const log = JSON.parse(cache.get('perf_buf') || '[]').concat(readJsonProp_('PERF_LOG', []));
  if (!log.length) return;
  cache.remove('perf_buf');
  PropertiesService.getScriptProperties().deleteProperty('PERF_LOG');
  const ss = systemSs_();
  let sh = ss.getSheetByName('ביצועים');
  if (!sh) { sh = ss.insertSheet('ביצועים'); sh.appendRow(['זמן', 'פעולה', 'שדות', 'בשרת (ms)', 'גרסה', 'הצליח', 'מסך מקומי (ms)', 'המתנה בתור (ms)', 'שלבים']); sh.setFrozenRows(1); }
  sh.getRange(sh.getLastRow() + 1, 1, log.length, 9).setValues(log.map(function (x) {
    return [Utilities.formatDate(new Date(x.t), TZ_, 'dd/MM HH:mm:ss'), x.a, x.f || '', x.ms, x.v || '', x.ok ? 'כן' : 'לא', x.lt === undefined ? '' : x.lt, x.qw === undefined ? '' : x.qw, x.ph || ''];
  }));
}
function actionPerfLog_(req, ctx) { return { log: readJsonProp_('PERF_LOG', []).slice().reverse() }; }

// ---------- שמירות מהמכשיר: כל שינוי עם מזהה ייחודי (opId), כדי ששליחה חוזרת לא תוחל פעמיים ----------
function opSeen_(req) {
  if (!req || !req.opId) return null;
  const v = CacheService.getScriptCache().get('op:' + req.opId);
  if (v) { try { return JSON.parse(v); } catch (e) { return { r: null }; } }
  // לא בזיכרון (6 שעות) – הרישום הקבוע: פעולה שכבר בוצעה לא מבוצעת שוב, גם אחרי שבוע
  return OPDONE_ON_ && opDoneHas_(req.opId) ? { r: null, durable: true } : null;
}
function opMark_(req, result) {
  if (!req || !req.opId) return;
  try { CacheService.getScriptCache().put('op:' + req.opId, JSON.stringify({ r: result || null }), 21600); } catch (e) { /* */ }
  if (OPDONE_ON_) opDoneAdd_(req.opId);
}

// ---------- רישום קבוע של פעולות שבוצעו (Script Properties: OPDONE_<יום>, מזהים מופרדים ברווח) ----------
// היום נלקח מהמזהה עצמו (הזמן שבו הפעולה נוצרה במכשיר) – כך שבדיקה = קריאה אחת. נשמר 30 יום.
const OPDONE_ON_ = true;   // דלוק (2026-11-01): ה-Properties תופסים 23KB מתוך ~500KB
const OPDONE_PFX_ = 'OPDONE_', OPDONE_MAX_ = 8500, OPDONE_DAYS_ = 30;
// תקרות: הרישום מתקרב ל-150KB → 14 יום; מעל 150KB → מוחקים את הימים הישנים עד שיורד. כל ה-Properties מעל 350KB → לא כותבים לרישום בכלל.
const OPDONE_SOFT_ = 120000, OPDONE_CAP_ = 150000, OPDONE_SHORT_DAYS_ = 14, PROPS_SAFE_ = 350000;
let OPLOG_MS_ = 0, ONCE_LOCK_MS_ = null, OPREWRITE_ = 0, WITHLOCK_ON_ = false;
function opBytes_(s) { return unescape(encodeURIComponent(String(s))).length; }
function opDay_(opId) {
  const t = parseInt(String(opId).split('-')[0], 36);
  return t > 1.7e12 && t < 4e12 ? Utilities.formatDate(new Date(t), TZ_, 'yyyyMMdd') : 'x';
}
function opShards_(opId) {
  const base = OPDONE_PFX_ + opDay_(opId), p = PropertiesService.getScriptProperties(), out = [];
  for (let i = 1; i <= 50; i++) {
    const k = i === 1 ? base : base + '_' + i, v = p.getProperty(k);
    if (v === null) break;
    out.push({ k: k, v: v });
  }
  return { base: base, list: out };
}
function opDoneHas_(opId) {
  const t0 = Date.now();
  try {
    const id = ' ' + opId + ' ';
    return opShards_(opId).list.some(function (x) { return (' ' + x.v + ' ').indexOf(id) >= 0; });
  } catch (e) { console.warn('opDone read: ' + e); return false; }
  finally { OPLOG_MS_ += Date.now() - t0; }
}
function opDoneAdd_(opId) {
  const t0 = Date.now();
  let lock = null;
  try {
    if (!WITHLOCK_ON_) { lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) lock = null; }
    const id = String(opId).replace(/\s/g, '');
    if (opDay_(id) === 'x') return;   // מזהה לא בפורמט – לא נרשם
    if (CacheService.getScriptCache().get('opdone_block')) { console.warn('opDone: הרישום עצור – ה-Properties קרובים לגבול'); return; }
    const sh = opShards_(id);
    if (sh.list.some(function (x) { return (' ' + x.v + ' ').indexOf(' ' + id + ' ') >= 0; })) return;
    const p = PropertiesService.getScriptProperties();
    // כתיבה + וידוא (אם בלי נעילה כתיבה מקבילה דרסה – כותבים שוב, עד 3 פעמים)
    for (let i = 0; i < 3; i++) {
      const cur = i ? opShards_(id) : sh;
      if (i && cur.list.some(function (x) { return (' ' + x.v + ' ').indexOf(' ' + id + ' ') >= 0; })) break;
      if (i) OPREWRITE_++;   // הווידוא גילה שהכתיבה הקודמת נדרסה – כותבים שוב (לספירה בדוח)
      const last = cur.list[cur.list.length - 1];
      if (last && last.v.length + id.length + 1 <= OPDONE_MAX_) p.setProperty(last.k, last.v + ' ' + id);
      else p.setProperty(last ? cur.base + '_' + (cur.list.length + 1) : cur.base, id);
      if (lock || WITHLOCK_ON_) break;   // עם נעילה – אין כתיבה מקבילה
    }
    if (!sh.list.length) opDonePrune_(p, Number(CacheService.getScriptCache().get('opdone_days')) || OPDONE_DAYS_);   // יום חדש – מוחקים ימים ישנים
  } catch (e) { console.warn('opDone write: ' + e); }
  finally { if (lock) lock.releaseLock(); OPLOG_MS_ += Date.now() - t0; }
}
/** מוחק רק מפתחות OPDONE_<8 ספרות> – אף Property אחר לא נמחק */
function opDonePrune_(p, days) {
  const cut = Utilities.formatDate(new Date(Date.now() - days * DAY_MS_), TZ_, 'yyyyMMdd');
  p.getKeys().forEach(function (k) {
    if (k.indexOf(OPDONE_PFX_) !== 0) return;
    const day = k.slice(OPDONE_PFX_.length, OPDONE_PFX_.length + 8);
    if (/^\d{8}$/.test(day) && day < cut) p.deleteProperty(k);
  });
}
/**
 * מתוך הבדיקה של כל 5 דקות, פעם ב-6 שעות: כמה תופסים כל ה-Properties (מפתח + ערך, בבתים) ומה מזה הרישום.
 * אוכף את התקרות ומדווח שורה ל"ביצועים" (שמות מפתחות וגדלים בלבד – בלי ערכים).
 */
function propsSizeCheck_() {
  const c = CacheService.getScriptCache();
  if (c.get('props_sz_at')) return;
  c.put('props_sz_at', '1', 21600);
  const p = PropertiesService.getScriptProperties();
  const all = p.getProperties();
  const sizes = Object.keys(all).map(function (k) { return { k: k, b: opBytes_(k) + opBytes_(all[k]) }; });
  const total = sizes.reduce(function (a, x) { return a + x.b; }, 0);
  const op = sizes.filter(function (x) { return x.k.indexOf(OPDONE_PFX_) === 0; });
  let opTotal = op.reduce(function (a, x) { return a + x.b; }, 0);
  let days = OPDONE_DAYS_, note = '';
  if (opTotal > OPDONE_SOFT_) {
    days = OPDONE_SHORT_DAYS_; opDonePrune_(p, days); note = ' · קוצר ל-' + days + ' יום';
    opTotal = 0; const keep = p.getKeys().filter(function (k) { return k.indexOf(OPDONE_PFX_) === 0; }).sort().reverse();
    keep.forEach(function (k) { const b = opBytes_(k) + opBytes_(p.getProperty(k) || ''); if (opTotal + b > OPDONE_CAP_) { p.deleteProperty(k); note += ' · נמחק ' + k; } else opTotal += b; });
  }
  c.put('opdone_days', String(days), 21600);
  const opKeys = p.getKeys().filter(function (k) { return k.indexOf(OPDONE_PFX_) === 0; }).length;
  const block = total - (sizes.filter(function (x) { return x.k.indexOf(OPDONE_PFX_) === 0; }).reduce(function (a, x) { return a + x.b; }, 0)) + opTotal > PROPS_SAFE_;
  if (block) c.put('opdone_block', '1', 21600); else c.remove('opdone_block');
  const top = sizes.slice().sort(function (a, b) { return b.b - a.b; }).slice(0, 8).map(function (x) { return x.k + ' ' + (x.b / 1024).toFixed(1) + 'KB'; }).join(', ');
  const entry = { t: Date.now(), a: 'propsSize', ms: 0, v: '', ok: !block, f: Math.round(total / 1024) + 'KB',
    ph: 'סה"כ ' + (total / 1024).toFixed(1) + 'KB · ' + sizes.length + ' מפתחות · רישום ' + (opTotal / 1024).toFixed(1) + 'KB (' + opKeys + ' מפתחות, ' + days + ' יום)' +
      (block ? ' · הרישום נעצר (מעל ' + PROPS_SAFE_ / 1000 + 'KB)' : '') + note + ' · הגדולים: ' + top };
  const lock = LockService.getScriptLock();
  if (lock.tryLock(5000)) {
    try { c.put('perf_buf', JSON.stringify(JSON.parse(c.get('perf_buf') || '[]').concat([entry]).slice(-80)), 21600); } finally { lock.releaseLock(); }
  }
}
function opDupOut_(dup, ctx) {
  return Object.assign({ duplicate: true, done: true }, (dup && dup.r) || {}, { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) });
}

/** כמה שינויים ברצף, לפי הסדר (כשיוצאים מהאפליקציה / בפתיחה הבאה). שינוי שכבר הוחל – מדולג. */
const BATCH_OK_ = { updateLead: 1, markAttempt: 1, undo: 1, redo: 1, coachAdd: 1, coachMinus: 1,
  lateClear: 1, gapClear: 1, debtClear: 1, anomClear: 1, lateCharge: 1, coachRenew: 1, finDecide: 1,
  finAddIncome: 1, finAddExpense: 1, finRemoveManual: 1, online: 1, assignZoom: 1, dismissZoom: 1, reminderSave: 1, reminderSet: 1 };
/**
 * פעולות שנכנסו לתור במכשיר (גרסה 48): אותה פעולה (אותו opId) מבוצעת פעם אחת בלבד –
 * גם אם הגיעה פעמיים (שליחה ביציאה מהאפליקציה בזמן שהבקשה המקורית עוד רצה, או שליחה חוזרת בפתיחה).
 * לפעולות שהיו בתור קודם (updateLead וכו') יש בדיקה משלהן, בתוך הנעילה.
 */
const OP_ONCE_ = { lateClear: 1, gapClear: 1, debtClear: 1, anomClear: 1, lateCharge: 1, coachRenew: 1, finDecide: 1,
  finAddIncome: 1, finAddExpense: 1, finRemoveManual: 1, online: 1, assignZoom: 1, dismissZoom: 1, reminderSave: 1, reminderSet: 1 };
function runAction_(action, req, ctx) {
  const fn = ACTIONS[action].fn;
  if (!OP_ONCE_[action] || !req.opId) return fn(req, ctx);
  const cache = CacheService.getScriptCache();
  // נעילה ממוקדת: נעילת המשתמש (לא של כל השרת), רק סביב הבדיקה + סימון "רץ" – הפעולה עצמה רצה אחריה.
  // שליחה שנייה של אותו מזהה בזמן שהראשונה רצה רואה "רץ" ולא מבצעת. בלי נעילה – לא ממשיכים (BUSY, האפליקציה מנסה שוב).
  const t0 = Date.now();
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) throw apiError_('BUSY', 'השרת עסוק, מנסה שוב');
  ONCE_LOCK_MS_ = (ONCE_LOCK_MS_ || 0) + Date.now() - t0;
  try {
    const seen = opSeen_(req);
    if (seen) return Object.assign({ duplicate: true }, seen.durable ? { durable: true, done: true } : {}, seen.r || {});
    if (cache.get('oprun:' + req.opId)) return { duplicate: true, running: true };
    cache.put('oprun:' + req.opId, '1', 420);   // 7 דק׳ (ריצה מוגבלת ל-6) – אם השרת נעצר באמצע, הסימון פג והשליחה הבאה מבצעת
  } finally { lock.releaseLock(); }
  try {
    const out = fn(req, ctx);
    const s = JSON.stringify(out || {});
    opMark_(req, s.length < 90000 ? out : {});
    return out;
  } finally { cache.remove('oprun:' + req.opId); }
}
function actionBatch_(req, ctx) {
  const results = [];
  (req.ops || []).slice(0, 40).forEach(function (op) {
    const p = Object.assign({}, op.params || {}, { action: op.action });
    if (!BATCH_OK_[op.action]) { results.push({ ok: false, opId: p.opId, error: 'פעולה לא מותרת' }); return; }
    // אותן הרשאות כמו בבקשה רגילה (שי – רק פעולות של לידים)
    if (ACTIONS[op.action].roles.indexOf(ctx.role) < 0) { results.push({ ok: false, opId: p.opId, code: 'FORBIDDEN', error: 'אין לך הרשאה לפעולה הזו' }); return; }
    try { results.push({ ok: true, opId: p.opId, data: runAction_(op.action, p, ctx) }); }
    catch (e) { results.push({ ok: false, opId: p.opId, code: e.code || 'ERROR', error: String(e.message || e) }); }
  });
  return { results: results };
}
