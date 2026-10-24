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
  anomClear:      { roles: ['admin'], fn: actionAnomClear_ },
  online:         { roles: ['admin'], fn: actionOnline_ },
  onboard:        { roles: ['admin'], fn: actionOnboard_ },
  onboardList:    { roles: ['admin'], fn: actionOnboardList_ },
  onboardRerun:   { roles: ['admin'], fn: actionOnboardRerun_ },
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

  const data = a.fn(req, { email: email, role: role, realRole: realRole, cfg: cfg });
  return { ok: true, data: data };
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
const PERF_ACTIONS_ = { updateLead: 1, markAttempt: 1, undo: 1, redo: 1 };
function logPerf_(e, out) {
  const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  if (!PERF_ACTIONS_[req.action]) return;
  const cache = CacheService.getScriptCache();
  const log = JSON.parse(cache.get('perf_buf') || '[]');
  log.push({ t: Date.now(), a: req.action, ms: out.ms, v: req.v || '', ok: !!out.ok, f: req.fields ? Object.keys(req.fields).join(',') : (req.kind || ''),
    ph: PHASES_ ? PHASES_.join(' · ') : '', lt: req._lt != null ? req._lt : '', qw: req._qw != null ? req._qw : '' });
  cache.put('perf_buf', JSON.stringify(log.slice(-40)), 21600);
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
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return { r: null }; }
}
function opMark_(req, result) {
  if (!req || !req.opId) return;
  try { CacheService.getScriptCache().put('op:' + req.opId, JSON.stringify({ r: result || null }), 21600); } catch (e) { /* */ }
}
function opDupOut_(dup, ctx) {
  return Object.assign({ duplicate: true, done: true }, (dup && dup.r) || {}, { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) });
}

/** כמה שינויים ברצף, לפי הסדר (כשיוצאים מהאפליקציה / בפתיחה הבאה). שינוי שכבר הוחל – מדולג. */
const BATCH_OK_ = { updateLead: 1, markAttempt: 1, undo: 1, redo: 1 };
function actionBatch_(req, ctx) {
  const results = [];
  (req.ops || []).slice(0, 40).forEach(function (op) {
    const p = Object.assign({}, op.params || {}, { action: op.action });
    if (!BATCH_OK_[op.action]) { results.push({ ok: false, opId: p.opId, error: 'פעולה לא מותרת' }); return; }
    try { results.push({ ok: true, opId: p.opId, data: ACTIONS[op.action].fn(p, ctx) }); }
    catch (e) { results.push({ ok: false, opId: p.opId, code: e.code || 'ERROR', error: String(e.message || e) }); }
  });
  return { results: results };
}
