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
  notifications:  { roles: ['admin', 'leads'], fn: actionNotifications_ },
  notifRead:      { roles: ['admin', 'leads'], fn: actionNotifRead_ },
  notifSettings:  { roles: ['admin', 'leads'], fn: actionNotifSettings_ },
  pushRegister:   { roles: ['admin', 'leads'], fn: actionPushRegister_ },
  pushUnregister: { roles: ['admin', 'leads'], fn: actionPushUnregister_ },
  pushTest:       { roles: ['admin', 'leads'], fn: actionPushTest_ },
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
  online:         { roles: ['admin'], fn: actionOnline_ },
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
