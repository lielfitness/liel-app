/**
 * "לא בוצעה פגישה 3 שבועות" (ליאל בלבד).
 * מחושב ברקע (פעם בשעה, מתוך הבדיקה של כל דקה) ונשמר – מסך המאמנים לא מחכה לזה.
 * פגישה = אירוע ירוק (colorId 10) ביומן, כמו בסקריפט הפגישות; שיוך לפי מייל, ואם אין – לפי שם.
 * פגישה אחרונה: עד שנה אחורה. הצטרפות: טופס הקליטה / תאריך הזום של הליד שנסגר / יצירת הקובץ "ליווי מקצועי - <שם>".
 */
const GAP_DAYS_ = 21;
const GAP_COLOR_ = '10';

function gapNorm_(t) {
  return String(t || '').replace(/[‎‏‪-‮]/g, '').replace(/[׳'"״()\-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** כל הפגישות הירוקות בשנה האחרונה ועד 3 חודשים קדימה (Calendar API – מהיר, בעמודים) */
function gapEvents_(cfg) {
  const now = Date.now();
  const out = [];
  let token = null;
  const owner = ownerEmail_(cfg);
  do {
    const r = Calendar.Events.list(cfg.calendarId || 'primary', {
      timeMin: new Date(now - 366 * DAY_MS_).toISOString(), timeMax: new Date(now + 92 * DAY_MS_).toISOString(),
      singleEvents: true, maxResults: 2500, pageToken: token || undefined,
      fields: 'nextPageToken,items(colorId,status,start,summary,description,attendees(email))',
    });
    (r.items || []).forEach(function (e) {
      if (e.colorId !== GAP_COLOR_ || e.status === 'cancelled' || !e.start || !e.start.dateTime) return;
      const m = String(e.description || '').match(/Booked by<\/b>\s*\n([^\n]+)/);
      const p = String(e.summary || '').match(/\(([^)]+)\)/);
      out.push({ t: new Date(e.start.dateTime).getTime(), name: gapNorm_(m ? m[1] : (p ? p[1] : e.summary)),
        emails: (e.attendees || []).map(function (a) { return String(a.email || '').toLowerCase(); }).filter(function (x) { return x && x !== owner; }) });
    });
    token = r.nextPageToken;
  } while (token);
  return out;
}

/** תאריך הצטרפות לפי מייל/שם (המוקדם מבין המקורות שנמצאו) */
function gapJoinDates_(cfg, coaches) {
  const join = {};
  const take = function (key, t) { if (key && t && (!join[key] || t < join[key])) join[key] = t; };
  // 1. טופס הקליטה
  try {
    const sh = SpreadsheetApp.openById(cfg.onboardSheetId).getSheets()[0];
    if (sh.getLastRow() > 1) {
      const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
      const ce = vals[0].map(String).indexOf('מייל');
      vals.slice(1).forEach(function (r) { if (r[0] instanceof Date && ce >= 0) take('e:' + String(r[ce]).trim().toLowerCase(), r[0].getTime()); });
    }
  } catch (e) { /* */ }
  // 2. הליד שנסגר (תוצאת זום = נסגר) – תאריך הזום
  try {
    cachedLeads_(cfg).leads.forEach(function (l) {
      if (String(l.zoomResult || '').trim() !== 'נסגר' || !l.zoomDate) return;
      const t = new Date(l.zoomDate + 'T12:00:00').getTime();
      const em = String(l.email || '').trim().toLowerCase();
      if (em && em !== '-') take('e:' + em, t);
    });
  } catch (e) { /* */ }
  // 3. הקובץ "ליווי מקצועי - <שם>" בדרייב
  try {
    const it = DriveApp.searchFiles("title contains 'ליווי מקצועי - ' and trashed = false");
    while (it.hasNext()) {
      const f = it.next();
      const nm = String(f.getName()).replace(/^ליווי מקצועי - /, '');
      take('n:' + gapNorm_(nm), f.getDateCreated().getTime());
    }
  } catch (e) { console.warn('drive: ' + e); }
  const out = {};
  coaches.forEach(function (c) {
    const ems = c.email.toLowerCase().split(/[,;\s]+/).filter(function (x) { return x.indexOf('@') > 0; });
    const ts = ems.map(function (e) { return join['e:' + e]; }).concat([join['n:' + gapNorm_(c.name)]]).filter(Boolean);
    if (ts.length) out[c.name] = Math.min.apply(null, ts);
  });
  return out;
}

/** מחשב את הרשימה ושומר (נקרא מהבדיקה של כל דקה – פעם בשעה, או כשמבקשים רענון) */
function computeCoachGap_(force) {
  const props = PropertiesService.getScriptProperties();
  const prev = readJsonProp_('GAP_DATA', null);
  if (!force && prev && Date.now() - prev.at < 60 * 60000) return prev;
  const cfg = getConfig_();
  const coaches = coachesData_(true).coaches;
  const events = gapEvents_(cfg);
  const joins = gapJoinDates_(cfg, coaches);
  const now = Date.now();
  const rows = [];
  coaches.forEach(function (c) {
    if (!(c.left > 0)) return;
    const ems = c.email.toLowerCase().split(/[,;\s]+/).filter(function (x) { return x.indexOf('@') > 0; });
    const key = gapNorm_(c.name);
    const mine = events.filter(function (e) { return e.emails.some(function (x) { return ems.indexOf(x) >= 0; }) || (e.name && e.name === key); });
    const past = mine.filter(function (e) { return e.t < now; }).map(function (e) { return e.t; });
    const fut = mine.filter(function (e) { return e.t >= now; }).map(function (e) { return e.t; });
    const last = past.length ? Math.max.apply(null, past) : null;
    const next = fut.length ? Math.min.apply(null, fut) : null;
    const joined = joins[c.name] || null;
    let show;
    if (last) show = now - last > GAP_DAYS_ * DAY_MS_;
    else if (joined) show = now - joined > GAP_DAYS_ * DAY_MS_;      // הצטרף לפני יותר מ-21 יום ועוד לא נפגש
    else show = c.pkg != null && c.left !== c.pkg;                     // ותיק שכבר השתמש בחבילה; C = D בלי תאריך = עוד לא התחיל
    if (!show) return;
    rows.push({ name: c.name, last: last, days: last ? Math.floor((now - last) / DAY_MS_) : null, left: c.left, next: next, joined: joined });
  });
  rows.sort(function (a, b) { return (b.days == null ? 9999 : b.days) - (a.days == null ? 9999 : a.days); });
  const data = { at: now, rows: rows };
  writeJsonProp_('GAP_DATA', data);
  return data;
}

/** לתצוגה: מה שנשמר, בלי מה שנוקה (נוקה = עד שתהיה פגישה חדשה) */
function coachGapView_() {
  const data = readJsonProp_('GAP_DATA', null);
  if (!data) return null;
  const cleared = {};
  sysRows_('gapClear').rows.forEach(function (r) { if (r[0]) cleared[r[0]] = 1; });
  return { at: data.at, rows: data.rows.filter(function (r) { return !cleared[gapKey_(r.name, r.last)]; }) };
}
function gapKey_(name, last) { return name + '|' + (last || 'none'); }

function actionGapClear_(req, ctx) {
  const key = gapKey_(String(req.name || ''), req.last || null);
  const d = sysRows_('gapClear');
  if (req.undo) { for (let i = d.rows.length - 1; i >= 0; i--) if (d.rows[i][0] === key) d.sh.deleteRow(i + 2); return { ok: true }; }
  if (!d.rows.some(function (r) { return r[0] === key; })) d.sh.appendRow([key, Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy HH:mm'), String(req.name || '')]);
  return { ok: true };
}

/** להרצה פעם אחת מהעורך: מאשר גישת קריאה לדרייב (תאריך יצירת "ליווי מקצועי - <שם>") ומחשב את הרשימה */
function authorizeDrive() {
  const it = DriveApp.searchFiles("title contains 'ליווי מקצועי - ' and trashed = false");
  let n = 0; while (it.hasNext() && n < 500) { it.next(); n++; }
  console.log('✅ יש גישה לדרייב – נמצאו ' + n + ' קבצי "ליווי מקצועי"');
  const d = computeCoachGap_(true);
  console.log('לא בוצעה פגישה 3 שבועות: ' + d.rows.length + ' מאמנים');
}
