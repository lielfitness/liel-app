/**
 * מרכז התראות + Push לטלפון (Firebase Cloud Messaging).
 *
 * הכל נשמר בגיליון מערכת נפרד ("Liel App – מערכת") שנוצר אוטומטית בדרייב של ליאל.
 * בגיליונות הקיימים לא נוגעים – רק קוראים מהם.
 *   התראות: מזהה | זמן | זמן (טקסט) | משתמש | סוג | כותרת | פרטים | קישור | נקרא
 *   מכשירים: משתמש | token | מכשיר | נוסף | עודכן
 *   הגדרות: משתמש | JSON {סוג: true/false}
 *
 * בהתראה: רק סוג ושם (בלי טלפון/מייל) – כי היא מוצגת גם במסך נעול.
 * הרשאות נאכפות כאן: כל סוג מוגדר לאילו תפקידים מותר (שי – רק לידים).
 *
 * Script Properties:
 *   FCM_SERVICE_ACCOUNT  קובץ ה-JSON של חשבון השירות מ-Firebase (סוד – ליאל מדביק בעצמו)
 *   NOTIFY_KEYS          (בהמשך) JSON {"שם-סקריפט": "מפתח"} – לסקריפטים אחרים ששולחים התראות
 *   SYSTEM_SHEET_ID      נוצר אוטומטית
 */

const NOTIF_TYPES_ = {
  lead_new:       { label: 'ליד חדש',  icon: '🎯', roles: ['admin', 'leads'] },
  zoom_booked:    { label: 'זום נקבע', icon: '📅', roles: ['admin'] },
  zoom_cancelled: { label: 'זום בוטל', icon: '❌', roles: ['admin'] },
  zoom_moved:     { label: 'זום הוזז', icon: '🔁', roles: ['admin'] },
  system:         { label: 'מערכת',    icon: 'ℹ️', roles: ['admin'] },   // לסקריפטים האחרים (בהמשך)
};
const SYS_TABS_ = {
  notif:    { name: 'התראות',  head: ['מזהה', 'זמן', 'זמן (טקסט)', 'משתמש', 'סוג', 'כותרת', 'פרטים', 'קישור', 'נקרא'] },
  devices:  { name: 'מכשירים', head: ['משתמש', 'token', 'מכשיר', 'נוסף', 'עודכן'] },
  settings: { name: 'הגדרות',  head: ['משתמש', 'הגדרות (JSON)'] },
};
const NOTIF_KEEP_DAYS_ = 60;
const NOTIF_LIST_MAX_ = 60;

// ---------- גיליון המערכת ----------
let SYS_SS_ = null;
function systemSs_() {
  if (SYS_SS_) return SYS_SS_;
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SYSTEM_SHEET_ID');
  if (id) {
    try { SYS_SS_ = SpreadsheetApp.openById(id); } catch (e) { id = null; }
  }
  if (!id) {
    // יכול לקרות גם בתוך פעולה שכבר מחזיקה את הנעילה – לכן tryLock ולא waitLock
    const lock = LockService.getScriptLock();
    const got = lock.tryLock(15000);
    try {
      id = props.getProperty('SYSTEM_SHEET_ID');
      if (id) SYS_SS_ = SpreadsheetApp.openById(id);
      else {
        SYS_SS_ = SpreadsheetApp.create('Liel App – מערכת (התראות)');
        SYS_SS_.setSpreadsheetTimeZone(TZ_);
        props.setProperty('SYSTEM_SHEET_ID', SYS_SS_.getId());
      }
    } finally { if (got) lock.releaseLock(); }
  }
  return SYS_SS_;
}

function sysTab_(k) {
  const ss = systemSs_();
  const t = SYS_TABS_[k];
  let sh = ss.getSheetByName(t.name);
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(t.name) : ss.insertSheet(t.name);
    sh.getRange(1, 1, 1, t.head.length).setValues([t.head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');   // הכל טקסט – בלי פענוח תאריכים/מספרים
  }
  return sh;
}

function sysRows_(k) {
  const sh = sysTab_(k);
  const n = sh.getLastRow();
  if (n < 2) return { sh: sh, rows: [] };
  return { sh: sh, rows: sh.getRange(2, 1, n - 1, SYS_TABS_[k].head.length).getDisplayValues() };
}

// ---------- הגדרות ----------
function readNotifSettings_() {
  const out = {};
  sysRows_('settings').rows.forEach(function (r) {
    try { out[String(r[0]).toLowerCase()] = JSON.parse(r[1] || '{}'); } catch (e) { /* */ }
  });
  return out;
}

function typesForRole_(role) {
  return Object.keys(NOTIF_TYPES_).filter(function (k) { return NOTIF_TYPES_[k].roles.indexOf(role) >= 0; });
}

// ---------- שליחת התראה ----------
/**
 * יוצר התראה לכל מי שמורשה לסוג הזה (ולא כיבה אותו בהגדרות), ושולח Push לטלפונים שלו.
 * p: { name, text?, link }   opts: { exclude: email, only: email }
 * לא זורק שגיאות – התראה שנכשלה לא מפילה את הפעולה שקראה לה.
 */
function notify_(type, p, opts) {
  try {
    opts = opts || {};
    const t = NOTIF_TYPES_[type];
    if (!t) return 0;
    const cfg = getConfig_();
    const settings = readNotifSettings_();
    const users = Object.keys(cfg.users).filter(function (e) {
      if (t.roles.indexOf(cfg.users[e]) < 0) return false;
      if (opts.exclude && e === String(opts.exclude).toLowerCase()) return false;
      if (opts.only && e !== String(opts.only).toLowerCase()) return false;
      return (settings[e] || {})[type] !== false;
    });
    if (!users.length) return 0;
    const sh = sysTab_('notif');
    const now = new Date();
    // הכותרת כוללת את השם (נראה ישר במסך הנעול): "📅 זום נקבע – דנה כהן · שלישי 28/10 14:30"
    const nm = shortName_(p.name);
    const title = p.title || (t.icon + ' ' + t.label + (nm ? ' – ' + nm : '') + (p.when ? ' · ' + whenText_(p.when) : ''));
    const body = p.text ? String(p.text) : '';
    users.forEach(function (e) {
      const id = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
      sh.appendRow([id, String(now.getTime()), Utilities.formatDate(now, TZ_, 'dd/MM/yyyy HH:mm'), e, type, title, body, p.link || '', '']);
      dropNotifCache_(e);
      try { pushToUser_(e, { id: id, type: type, title: title, body: body, link: p.link || '' }); } catch (err) { console.warn('push: ' + err); }
    });
    return users.length;
  } catch (e) {
    console.warn('notify_ ' + type + ': ' + (e.message || e));
    return 0;
  }
}

function dropNotifCache_(email) {
  try { CacheService.getScriptCache().remove('nl1:' + email); } catch (e) { /* */ }
}

// ---------- פעולות לאפליקציה ----------
function actionNotifications_(req, ctx) {
  const role = ctx.realRole;
  const types = typesForRole_(role);
  const cache = CacheService.getScriptCache();
  let list = null;
  const hit = cache.get('nl1:' + ctx.email);
  if (hit) list = JSON.parse(hit);
  else {
    list = sysRows_('notif').rows
      .filter(function (r) { return String(r[3]).toLowerCase() === ctx.email && types.indexOf(r[4]) >= 0; })
      .slice(-NOTIF_LIST_MAX_).reverse()
      .map(function (r) { return { id: r[0], at: Number(r[1]) || 0, type: r[4], title: r[5], body: r[6], link: r[7], read: !!r[8] }; });
    const s = JSON.stringify(list);
    if (s.length < 90000) cache.put('nl1:' + ctx.email, s, 600);
  }
  const mine = readNotifSettings_()[ctx.email] || {};
  const settings = {};
  types.forEach(function (k) { settings[k] = mine[k] !== false; });
  return {
    items: list,
    unread: list.filter(function (n) { return !n.read; }).length,
    types: types.map(function (k) { return { k: k, label: NOTIF_TYPES_[k].label, icon: NOTIF_TYPES_[k].icon }; }),
    settings: settings,
    push: { configured: !!PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT'), devices: myDevices_(ctx.email).length },
  };
}

function actionNotifRead_(req, ctx) {
  const ids = {};
  (req.ids || []).forEach(function (i) { ids[i] = 1; });
  const d = sysRows_('notif');
  const stamp = Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy HH:mm');
  let n = 0;
  d.rows.forEach(function (r, i) {
    if (String(r[3]).toLowerCase() !== ctx.email || r[8]) return;
    if (!req.all && !ids[r[0]]) return;
    d.sh.getRange(i + 2, 9).setValue(stamp);
    n++;
  });
  dropNotifCache_(ctx.email);
  return { marked: n };
}

function actionNotifSettings_(req, ctx) {
  const allowed = typesForRole_(ctx.realRole);
  const d = sysRows_('settings');
  const i = d.rows.findIndex(function (r) { return String(r[0]).toLowerCase() === ctx.email; });
  let cur = {};
  if (i >= 0) { try { cur = JSON.parse(d.rows[i][1] || '{}'); } catch (e) { cur = {}; } }
  Object.keys(req.settings || {}).forEach(function (k) {
    if (allowed.indexOf(k) >= 0) cur[k] = !!req.settings[k];
  });
  if (i >= 0) d.sh.getRange(i + 2, 2).setValue(JSON.stringify(cur));
  else d.sh.appendRow([ctx.email, JSON.stringify(cur)]);
  return { ok: true };
}

// ---------- מכשירים (Push) ----------
function myDevices_(email) {
  return sysRows_('devices').rows.filter(function (r) { return String(r[0]).toLowerCase() === email && r[1]; });
}

function actionPushRegister_(req, ctx) {
  if (ctx.role !== ctx.realRole) throw apiError_('BAD_REQUEST', 'בתצוגה "כמו שי" אי אפשר להפעיל התראות – חזרו לתצוגה שלכם');
  const token = String(req.token || '').trim();
  if (token.length < 20 || token.length > 4096) throw apiError_('BAD_REQUEST', 'מזהה מכשיר לא תקין');
  const d = sysRows_('devices');
  const stamp = Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy HH:mm');
  const i = d.rows.findIndex(function (r) { return r[1] === token; });
  const device = String(req.device || '').slice(0, 80);
  if (i >= 0) d.sh.getRange(i + 2, 1, 1, 5).setValues([[ctx.email, token, device, d.rows[i][3], stamp]]);
  else d.sh.appendRow([ctx.email, token, device, stamp, stamp]);
  if (req.oldToken && req.oldToken !== token) removeDevice_(req.oldToken);
  return { ok: true, devices: myDevices_(ctx.email).length };
}

function actionPushUnregister_(req, ctx) {
  const d = sysRows_('devices');
  const i = d.rows.findIndex(function (r) { return r[1] === req.token && String(r[0]).toLowerCase() === ctx.email; });
  if (i >= 0) d.sh.deleteRow(i + 2);
  return { ok: true };
}

function removeDevice_(token) {
  const d = sysRows_('devices');
  for (let i = d.rows.length - 1; i >= 0; i--) if (d.rows[i][1] === token) d.sh.deleteRow(i + 2);
}

function actionPushTest_(req, ctx) {
  const devs = myDevices_(ctx.email);
  if (!devs.length) return { sent: 0, message: 'אין טלפון רשום להתראות' };
  const r = pushToUser_(ctx.email, { id: 'test', type: 'system', title: '🔔 בדיקה', body: 'ההתראות עובדות ✓', link: '#/notifs' });
  return { sent: r.sent, failed: r.failed, message: r.error || '' };
}

// ---------- Firebase Cloud Messaging ----------
function fcmAuth_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fcm_at1');
  if (hit) return { token: hit, project: sa.project_id };
  const now = Math.floor(Date.now() / 1000);
  const b64 = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = b64(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key));
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig },
  });
  if (res.getResponseCode() !== 200) throw new Error('Firebase: התחברות נכשלה (' + res.getResponseCode() + ') – בדקו את FCM_SERVICE_ACCOUNT');
  const at = JSON.parse(res.getContentText()).access_token;
  cache.put('fcm_at1', at, 3000);
  return { token: at, project: sa.project_id };
}

/** שולח לכל הטלפונים של המשתמש. מכשיר שגוגל אומרת שכבר לא קיים – נמחק מהרשימה. */
function pushToUser_(email, n) {
  const devs = myDevices_(email);
  const out = { sent: 0, failed: 0, error: '' };
  if (!devs.length) return out;
  const auth = fcmAuth_();
  if (!auth) { out.error = 'Push עוד לא הוגדר (חסר FCM_SERVICE_ACCOUNT)'; return out; }
  const reqs = devs.map(function (r) {
    return {
      url: 'https://fcm.googleapis.com/v1/projects/' + auth.project + '/messages:send',
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + auth.token },
      payload: JSON.stringify({ message: {
        token: r[1],
        data: { id: String(n.id), type: String(n.type), title: String(n.title), body: String(n.body), link: String(n.link || '') },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } },
      } }),
    };
  });
  UrlFetchApp.fetchAll(reqs).forEach(function (res, i) {
    const code = res.getResponseCode();
    if (code === 200) { out.sent++; return; }
    out.failed++;
    const txt = res.getContentText();
    if (code === 404 || /UNREGISTERED|registration-token-not-registered/.test(txt)) removeDevice_(devs[i][1]);
    else out.error = 'Firebase ' + code + ': ' + txt.slice(0, 200);
    console.warn('FCM ' + code + ' ' + txt.slice(0, 300));
  });
  return out;
}

// ---------- זיהוי ליד חדש בגיליון (Webflow) – טריגר כל דקה ----------
const WATCH_PROP_ = 'LEADS_WATCH';
const WATCH_TAIL_ = 250;

/** מפתח יציב לליד: טלפון + תאריך כניסה (מייל שנוסף מהזמנת זום לא משנה אותו). */
function watchKey_(l) {
  const base = (phoneKey_(l.phone) || 'n:' + normName_(l.name)) + '|' + String(l.entryRaw || l.entry || '');
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
  return b.slice(0, 5).map(function (x) { return ((x + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function watchNewLeads() {
  const t0 = Date.now();
  try { return watchNewLeadsCore_(t0); } finally { trackRun_('watch', t0); }
}

function watchNewLeadsCore_(t0) {
  const cfg = getConfig_();
  const props = PropertiesService.getScriptProperties();
  // בדיקה קלה: רק עמודות שם+טלפון. אם לא השתנה כלום – יוצאים.
  let sig = null;
  try {
    const v = Sheets.Spreadsheets.Values.get(cfg.leadsSheetId, "'" + LEADS_TAB_ + "'!B2:C").values || [];
    sig = v.length + '|' + JSON.stringify(v[v.length - 1] || []);
  } catch (e) { /* בלי Sheets API – קוראים הכל */ }
  const st = readJsonProp_(WATCH_PROP_, null);
  if (st && sig && st.sig === sig) { watchStats_(t0, false); return; }

  const leads = readLeads_(cfg).leads.filter(function (l) { return l.name || l.phone; });
  const tail = leads.slice(-WATCH_TAIL_);
  const keys = tail.map(watchKey_);
  if (!st) {   // הפעלה ראשונה: רק רושמים את מה שקיים – בלי מבול התראות
    writeJsonProp_(WATCH_PROP_, { sig: sig, keys: keys });
    watchStats_(t0, true);
    return;
  }
  const seen = {};
  (st.keys || []).forEach(function (k) { seen[k] = 1; });
  const since = Utilities.formatDate(new Date(Date.now() - 3 * DAY_MS_), TZ_, 'yyyy-MM-dd');
  const fresh = tail.filter(function (l, i) {
    return !seen[keys[i]] && !/^ידני/.test(String(l.ad || '')) && (!l.entry || l.entry >= since);
  });
  writeJsonProp_(WATCH_PROP_, { sig: sig, keys: keys });
  const todo = fresh.filter(function (l) { return claimLeadNotice_(watchKey_(l)); });
  if (todo.length > 5) {
    notify_('lead_new', { title: '🎯 ' + todo.length + ' לידים חדשים', link: '#/leads' });
  } else {
    todo.forEach(function (l) { notify_('lead_new', { name: l.name || l.phone, link: '#/lead/' + l.id }); });
  }
  if (fresh.length) invalidateLeads_();
  watchStats_(t0, true);
  pruneNotifs_();
}

/** כמה זמן לוקחת הבדיקה – כדי לוודא שלא מתקרבים למכסה היומית של גוגל (90 דק׳ לטריגרים). */
function watchStats_(t0, full) {
  const s = readJsonProp_('WATCH_STATS', { day: '', runs: 0, ms: 0, full: 0 });
  const day = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
  if (s.day !== day) { s.prev = s.day ? { day: s.day, runs: s.runs, ms: s.ms } : s.prev; s.day = day; s.runs = 0; s.ms = 0; s.full = 0; }
  s.runs++; s.ms += Date.now() - t0; if (full) s.full++;
  s.last = Date.now();
  writeJsonProp_('WATCH_STATS', s);
}

/** פעם ביום: מוחק התראות ישנות מ-60 יום */
function pruneNotifs_() {
  const props = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
  if (props.getProperty('NOTIF_PRUNED') === day) return;
  props.setProperty('NOTIF_PRUNED', day);
  const d = sysRows_('notif');
  const cutoff = Date.now() - NOTIF_KEEP_DAYS_ * DAY_MS_;
  let n = 0;
  while (n < d.rows.length && (Number(d.rows[n][1]) || 0) < cutoff) n++;
  if (n) d.sh.deleteRows(2, n);
}

function notifyStatus_() {
  const s = readJsonProp_('WATCH_STATS', null);
  const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'watchNewLeads'; });
  return {
    trigger: hasTrigger,
    last: s ? s.last : null,
    runs: s ? s.runs : 0,
    minutes: Number(PropertiesService.getScriptProperties().getProperty('WATCH_MINUTES') || 1),
    avgMs: s && s.runs ? Math.round(s.ms / s.runs) : 0,
    push: !!PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT'),
  };
}

/** מבטיח שעל אותו ליד תצא התראה אחת בלבד (Make והבדיקה כל דקה יכולים לזהות את אותו ליד). */
function claimLeadNotice_(key) {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('lnk:' + key)) return false;
    cache.put('lnk:' + key, '1', 6 * 3600);
    return true;
  } finally { if (got) lock.releaseLock(); }
}

/** "מאמנת כושר | Daniell Blaish 💪" → "Daniell Blaish": החלק שהוא שם, שם פרטי + משפחה בלבד */
function shortName_(full) {
  const raw = String(full || '').trim();
  if (!raw) return '';
  const parts = raw.split(/\s[-–—]\s|[|｜•·\/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  const generic = /(מאמנ|מאמן|כושר|פילאטיס|סטודיו|fitness|coach|trainer|תזונה|אונליין)/i;
  const pick = parts.filter(function (x) { return !generic.test(x); })[0] || parts[0] || raw;
  const words = pick.replace(/[^\p{L}\p{M}\s'"׳״-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).join(' ') : raw.slice(0, 30);
}

/** תאריך → "שלישי 28/10 14:30" (שעון ישראל) */
function whenText_(d) {
  d = d instanceof Date ? d : new Date(d);
  const days = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון'];   // u: 1=שני … 7=ראשון
  return days[Number(Utilities.formatDate(d, TZ_, 'u')) - 1] + ' ' + Utilities.formatDate(d, TZ_, 'dd/MM HH:mm');
}

// ---------- נקודת התראות לסקריפטים אחרים (Make וכו') ----------
/**
 * בקשה בלי התחברות, עם מפתח של השולח (NOTIFY_KEYS).
 *   ליד חדש: { action:"notify", key, type:"lead_new", name, phone, email }
 *     → מוצא את הליד בגיליון (לפי טלפון/מייל) כדי שלחיצה תפתח את הכרטיס שלו. התראה אחת בלבד לליד.
 *   אחר:     { action:"notify", key, title, text, link } → לליאל בלבד
 */
function externalNotify_(req) {
  const keys = readJsonProp_('NOTIFY_KEYS', {});
  const src = Object.keys(keys).filter(function (k) { return keys[k] && keys[k] === req.key; })[0];
  if (!src) throw apiError_('FORBIDDEN', 'מפתח לא תקין');
  if (req.type === 'lead_new') {
    const name = String(req.name || '').trim().slice(0, 120);
    const pk = phoneKey_(req.phone), em = String(req.email || '').trim().toLowerCase();
    let lead = null;
    try {
      invalidateLeads_();
      const all = readLeads_(getConfig_()).leads;
      for (let i = all.length - 1; i >= Math.max(0, all.length - 50) && !lead; i--) {
        const l = all[i];
        if ((pk && phoneKey_(l.phone) === pk) || (em && String(l.email || '').trim().toLowerCase() === em)) lead = l;
      }
    } catch (e) { console.warn('notify: ' + e); }
    const key = lead ? watchKey_(lead) : 'ext:' + (pk || em || normName_(name));
    if (!claimLeadNotice_(key)) return { ok: true, notified: 0, duplicate: true };
    const n = notify_('lead_new', { name: (lead && lead.name) || name || req.phone || 'ליד', link: lead ? '#/lead/' + lead.id : '#/leads' });
    return { ok: true, notified: n, found: !!lead };
  }
  const n = notify_('system', { name: String(req.title || req.name || src).slice(0, 120), text: String(req.text || '').slice(0, 200), link: String(req.link || '').slice(0, 200) });
  return { ok: true, notified: n };
}

// ---------- להרצה ידנית מהעורך ----------
/** יוצר מפתח לשולח חיצוני (ברירת מחדל: make) ומדפיס אותו בלוג – להעתקה ל-Make. מפתח קודם לאותו שולח מוחלף. */
function createNotifyKey(source) {
  source = String(source || 'make');
  const keys = readJsonProp_('NOTIFY_KEYS', {});
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  keys[source] = key;
  writeJsonProp_('NOTIFY_KEYS', keys);
  console.log('🔑 המפתח של "' + source + '" (להעתיק ל-Make, לא לשלוח לאף אחד):\n' + key);
}

/** בודק שההגדרה של Firebase תקינה (בלי לשלוח התראה לאף אחד). */
function checkPushSetup() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT');
  if (!raw) { console.log('❌ חסר FCM_SERVICE_ACCOUNT ב-Script Properties'); return; }
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { console.log('❌ FCM_SERVICE_ACCOUNT לא נקרא כ-JSON – כנראה הודבק חלקית. הדביקו שוב את כל הקובץ.'); return; }
  console.log('פרויקט: ' + sa.project_id + ' · חשבון: ' + String(sa.client_email || '').replace(/^(.{6}).*(@.*)$/, '$1…$2'));
  CacheService.getScriptCache().remove('fcm_at1');
  let auth;
  try { auth = fcmAuth_(); } catch (e) { console.log('❌ ' + e.message); return; }
  // שליחה "על יבש" למכשיר מומצא: אם ההרשאה תקינה גוגל עונה "מזהה מכשיר לא תקין" (400)
  const res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + auth.project + '/messages:send', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + auth.token },
    payload: JSON.stringify({ validate_only: true, message: { token: 'bad-token-check', data: { t: 'x' } } }),
  });
  const code = res.getResponseCode();
  if (code === 400 || code === 200) console.log('✅ Firebase מוגדר נכון – אפשר להפעיל התראות בטלפון');
  else if (code === 403) console.log('❌ אין הרשאה (403). ב-Firebase: Project settings ← Cloud Messaging – ודאו ש-"Firebase Cloud Messaging API (V1)" במצב Enabled.\n' + res.getContentText().slice(0, 300));
  else console.log('❌ Firebase החזיר ' + code + ':\n' + res.getContentText().slice(0, 300));
  const devs = sysRows_('devices').rows.filter(function (r) { return r[1]; });
  console.log('טלפונים רשומים: ' + devs.length);
}

/** משנה את תדירות הבדיקה של לידים חדשים (1/5/10/15/30 דק׳) – למשל אחרי שההתראה מ-Make עובדת. */
function setLeadWatchMinutes(n) {
  n = [1, 5, 10, 15, 30].indexOf(Number(n)) >= 0 ? Number(n) : 15;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'watchNewLeads') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('watchNewLeads').timeBased().everyMinutes(n).create();
  PropertiesService.getScriptProperties().setProperty('WATCH_MINUTES', String(n));
  console.log('✅ בדיקת לידים חדשים: כל ' + n + ' דק׳ (גיבוי ל-Make)');
}
function setLeadWatch15() { setLeadWatchMinutes(15); }

// ---------- הפעלה ראשונה (מהעורך) ----------
/** יוצר את גיליון המערכת ואת טריגר הבדיקה כל דקה (רק בפרויקט הזה). לא נוגע בטריגרים אחרים. */
function setupNotifications() {
  const ss = systemSs_();
  Object.keys(SYS_TABS_).forEach(sysTab_);
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'watchNewLeads'; });
  if (!has) ScriptApp.newTrigger('watchNewLeads').timeBased().everyMinutes(1).create();
  watchNewLeads();
  console.log('✅ גיליון המערכת: ' + ss.getName() + '\n' + ss.getUrl());
  console.log('✅ בדיקת לידים חדשים כל דקה ' + (has ? '(כבר הייתה פעילה)' : '(הותקנה עכשיו)'));
  console.log(PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT') ? '✅ Push מוגדר' : 'ℹ️ Push עוד לא מוגדר (FCM_SERVICE_ACCOUNT חסר) – מרכז ההתראות באפליקציה כבר עובד');
}
