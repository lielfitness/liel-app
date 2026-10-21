/**
 * קביעת זום: סריקת אירועי "פגישת אפיון" ביומן של ליאל (טריגר כל 10 דק').
 * - התאמה ודאית לליד (מייל/טלפון) → ממלא R (תאריך זום) ו-N = "זום נקבע", ושולח לליאל הודעה בטלגרם.
 * - אין התאמה / לליד כבר יש תאריך זום אחר → נשמר כהתראה באפליקציה לשיוך ידני (+ הודעה בטלגרם).
 * לא דורס תאריך זום שכבר מולא. בהרצה הראשונה רק מסמן את האירועים הקיימים כ"נראו" (בלי לכתוב כלום).
 */

const ZOOM_TITLE_ = 'פגישת אפיון';
const ZOOM_SEEN_KEY_ = 'ZOOM_SEEN';
const ZOOM_ALERTS_KEY_ = 'ZOOM_ALERTS';

function zoomCalendar_(cfg) {
  const id = cfg.calendarId;
  const cal = (!id || id === 'primary') ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('היומן לא נמצא: ' + id);
  return cal;
}

function zoomEvents_(cfg) {
  const now = Date.now();
  return zoomCalendar_(cfg)
    .getEvents(new Date(now - DAY_MS_), new Date(now + 120 * DAY_MS_))
    .filter(function (ev) { return String(ev.getTitle()).indexOf(ZOOM_TITLE_) >= 0; });
}

function eventKey_(ev) {
  return ev.getId() + '|' + ev.getStartTime().getTime();
}

function readJsonProp_(key, def) {
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  try { return raw ? JSON.parse(raw) : def; } catch (e) { return def; }
}

function writeJsonProp_(key, val) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(val));
}

function pruneSeen_(seen) {
  const cutoff = Date.now() - 3 * DAY_MS_;
  Object.keys(seen).forEach(function (k) { if (seen[k] < cutoff) delete seen[k]; });
  return seen;
}

/** מסמן את כל האירועים הקיימים כ"נראו" – כדי שבהפעלה לא יישלחו הודעות/ייכתבו נתונים על פגישות ישנות. */
function seedZoomSeen_() {
  const seen = {};
  zoomEvents_(getConfig_()).forEach(function (ev) { seen[eventKey_(ev)] = ev.getStartTime().getTime(); });
  writeJsonProp_(ZOOM_SEEN_KEY_, seen);
  return Object.keys(seen).length;
}

function normName_(s) {
  return String(s || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function bookerInfo_(ev, cfg) {
  const skip = Object.keys(cfg.users);
  const me = ownerEmail_(cfg);
  const emails = {};
  const staffNames = {};   // שמות של ליאל/שי – כשהן מזמינות בשם עצמן, זה לא השם של הליד
  ev.getGuestList().forEach(function (g) {
    const e = String(g.getEmail() || '').toLowerCase();
    if (e && e !== me && skip.indexOf(e) < 0) emails[e] = 1;
    if (e && (e === me || skip.indexOf(e) >= 0) && g.getName()) staffNames[normName_(g.getName())] = 1;
  });
  Object.keys(cfg.names || {}).forEach(function (k) { staffNames[normName_(cfg.names[k])] = 1; });
  const desc = String(ev.getDescription() || '').replace(/<[^>]+>/g, ' ');
  (desc.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).forEach(function (e) {
    e = e.toLowerCase();
    if (e !== me && skip.indexOf(e) < 0) emails[e] = 1;
  });
  const phones = {};
  (desc.match(/(?:\+?972|0)[\s\-]?5\d(?:[\s\-]?\d){7}/g) || []).forEach(function (p) {
    const k = phoneKey_(p);
    if (k) phones[k] = 1;
  });
  const title = String(ev.getTitle());
  const nm = title.match(/\(([^)]+)\)/);
  let name = nm ? nm[1].trim() : title.replace(ZOOM_TITLE_, '').replace(/[-–:|]/g, ' ').trim();
  const bookedByStaff = !!staffNames[normName_(name)];
  if (bookedByStaff) name = '';   // שי הזמינה עם הפרטים שלה – השם בכותרת הוא שלה
  return {
    emails: Object.keys(emails), phones: Object.keys(phones), name: name,
    desc: normName_(desc), bookedByStaff: bookedByStaff,
  };
}

/** התאמה ודאית בלבד: מייל/טלפון; אחרת שם זהה; אחרת שם הליד שמופיע בתיאור. אם יש כמה אפשרויות – אין התאמה. */
function matchLead_(leads, info) {
  const newest = function (arr) { return arr.sort(function (a, b) { return b.row - a.row; })[0]; };
  const byContact = leads.filter(function (l) {
    const em = String(l.email || '').trim().toLowerCase();
    return (em && info.emails.indexOf(em) >= 0) || (phoneKey_(l.phone) && info.phones.indexOf(phoneKey_(l.phone)) >= 0);
  });
  if (byContact.length) return { lead: newest(byContact), how: 'מייל/טלפון' };   // ליד שנכנס פעמיים – הכי חדש

  const uniquePerson = function (arr) {
    const keys = {};
    arr.forEach(function (l) { keys[phoneKey_(l.phone) || normName_(l.name)] = 1; });
    return Object.keys(keys).length === 1 ? newest(arr) : null;
  };
  if (info.name) {
    const n = normName_(info.name);
    const byName = leads.filter(function (l) { return normName_(l.name) === n; });
    const one = byName.length ? uniquePerson(byName) : null;
    if (one) return { lead: one, how: 'שם' };
    if (byName.length) return { lead: null, ambiguous: true };
  }
  if (info.desc) {
    const inDesc = leads.filter(function (l) {
      const n = normName_(l.name);
      return n.length >= 5 && n.indexOf(' ') > 0 && (' ' + info.desc + ' ').indexOf(' ' + n + ' ') >= 0;
    });
    const one = inDesc.length ? uniquePerson(inDesc) : null;
    if (one) return { lead: one, how: 'שם בתיאור' };
    if (inDesc.length) return { lead: null, ambiguous: true };
  }
  return { lead: null };
}

function fmtWhen_(d) {
  return Utilities.formatDate(d, TZ_, 'dd/MM/yyyy HH:mm');
}

/** טריגר שינוי ביומן – כמעט מיידי (מותקן אוטומטית מתוך הסריקה). */
function onCalendarChange() {
  try { scanZoomBookings('calendar'); } catch (e) { console.warn('onCalendarChange: ' + (e.message || e)); }
}

/** המייל של בעל היומן – לפי מזהה היומן (ביומן הראשי זה המייל), בלי Session (שדורש הרשאה נוספת). */
let OWNER_EMAIL_ = null;
function ownerEmail_(cfg) {
  if (OWNER_EMAIL_ == null) OWNER_EMAIL_ = String(zoomCalendar_(cfg || getConfig_()).getId() || '').toLowerCase();
  return OWNER_EMAIL_;
}

function ensureCalendarTrigger_(force) {
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('CAL_TRIGGER') === 'ok') return props.getProperty('CAL_TRIGGER');
  try {
    const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onCalendarChange'; });
    if (!has) ScriptApp.newTrigger('onCalendarChange').forUserCalendar(zoomCalendar_(getConfig_()).getId()).onEventUpdated().create();
    props.setProperty('CAL_TRIGGER', 'ok');
  } catch (e) {
    props.setProperty('CAL_TRIGGER', 'error: ' + (e.message || e));
  }
  return props.getProperty('CAL_TRIGGER');
}

/** להרצה ידנית מהעורך: מתקין את הטריגר המיידי ובודק שסריקת הזומים עובדת. */
function installZoomTrigger() {
  const status = ensureCalendarTrigger_(true);
  console.log(status === 'ok' ? '✅ הטריגר המיידי מותקן ("שינוי ביומן")' : '❌ ' + status);
  console.log('יומן: ' + ownerEmail_() + ' | אירועי "' + ZOOM_TITLE_ + '" ב-120 הימים הקרובים: ' + zoomEvents_(getConfig_()).length);
  scanZoomBookings('manual');
  console.log('✅ סריקת זומים רצה בלי שגיאות');
}

/** הטריגר (כל 10 דקות, וגם מטריגר היומן). */
function scanZoomBookings(via) {
  const cfg = getConfig_();
  if (via !== 'calendar') ensureCalendarTrigger_();
  withLock_(function () {
    const seen = pruneSeen_(readJsonProp_(ZOOM_SEEN_KEY_, null) || {});
    const events = zoomEvents_(cfg).filter(function (ev) { return !seen[eventKey_(ev)]; });
    if (!events.length) { writeJsonProp_(ZOOM_SEEN_KEY_, seen); return; }

    const r = readLeads_(cfg);
    const alerts = readJsonProp_(ZOOM_ALERTS_KEY_, []);
    const appUrl = String(cfg.appUrl || '').replace(/\/?$/, '/');

    events.forEach(function (ev) {
      const key = eventKey_(ev);
      const start = ev.getStartTime();
      const info = bookerInfo_(ev, cfg);
      const match = matchLead_(r.leads, info);
      const lead = match.lead;
      const iso = isoDate_(new Date(start.getFullYear(), start.getMonth(), start.getDate()));

      if (lead && (!lead.zoomDate || lead.zoomDate === iso)) {
        if (!lead.zoomDate) setDateCell_(r.sh, lead.row, COL_.zoomDate, parseIso_(iso));
        if (!isFinal_(lead.status) && canonicalStatus_(lead.status) !== 'זום נקבע') r.sh.getRange(lead.row, COL_.status).setValue('זום נקבע');
        touch_(r.sh, lead.row, r.upCol);
        SpreadsheetApp.flush();
        const r2 = readLeads_(cfg);
        syncRewards_(r2.sh, r2.leads, [iso.slice(0, 7)], false);
        sendTelegram_('📅 <b>זום חדש נקבע</b>\n' + esc_(lead.name) + '\n' + fmtWhen_(start),
          [{ text: 'פתח כרטיס ליד', url: appUrl + '#/lead/' + lead.id }]);
        // כמה זמן עבר מהקביעה ביומן עד שהליד עודכן
        const created = ev.getDateCreated ? ev.getDateCreated().getTime() : 0;
        writeJsonProp_('ZOOM_LAST', { name: lead.name, how: match.how, via: via === 'calendar' ? 'שינוי ביומן' : 'סריקה כל 10 דק׳',
          createdAt: created, updatedAt: Date.now(), seconds: created ? Math.round((Date.now() - created) / 1000) : null });
      } else {
        const reason = lead ? 'לליד כבר רשום תאריך זום אחר (' + fmtDate_(parseIso_(lead.zoomDate)) + ')'
          : match.ambiguous ? 'נמצאו כמה לידים מתאימים – צריך לבחור ידנית'
          : info.bookedByStaff ? 'הפגישה נקבעה עם הפרטים של שי ולא של הליד – צריך לשייך ידנית'
          : 'לא נמצא ליד עם המייל/הטלפון/השם של המזמין';
        alerts.push({
          key: key, start: start.getTime(), title: ev.getTitle(), name: info.name,
          emails: info.emails, phones: info.phones, reason: reason,
          leadId: lead ? lead.id : '', leadRow: lead ? lead.row : 0, createdAt: Date.now(),
        });
        sendTelegram_('📅 <b>זום חדש נקבע – צריך שיוך ידני</b>\n' + esc_(info.name || ev.getTitle()) + '\n' + fmtWhen_(start) + '\n' + esc_(reason),
          [{ text: 'פתח באפליקציה', url: appUrl + '#/zooms' }]);
      }
      seen[key] = start.getTime();
    });

    writeJsonProp_(ZOOM_ALERTS_KEY_, alerts.filter(function (a) { return a.start > Date.now() - 30 * DAY_MS_; }));
    writeJsonProp_(ZOOM_SEEN_KEY_, seen);
  });
}

function actionZoomAlerts_() {
  return { alerts: readJsonProp_(ZOOM_ALERTS_KEY_, []) };
}

function actionAssignZoom_(req, ctx) {
  return withLock_(function () {
    const alerts = readJsonProp_(ZOOM_ALERTS_KEY_, []);
    const a = alerts.filter(function (x) { return x.key === req.key; })[0];
    if (!a) throw apiError_('STALE', 'ההתראה כבר טופלה');
    const loc = locateLead_(ctx.cfg, req.row, req.id);
    const s = new Date(a.start);
    setDateCell_(loc.sh, loc.lead.row, COL_.zoomDate, new Date(s.getFullYear(), s.getMonth(), s.getDate()));
    if (!isFinal_(loc.lead.status)) loc.sh.getRange(loc.lead.row, COL_.status).setValue('זום נקבע');
    touch_(loc.sh, loc.lead.row, loc.upCol);
    SpreadsheetApp.flush();
    const r2 = readLeads_(ctx.cfg);
    const res = syncRewards_(r2.sh, r2.leads, [loc.lead.zoomDate.slice(0, 7), monthKey_(s)], false);
    writeJsonProp_(ZOOM_ALERTS_KEY_, alerts.filter(function (x) { return x.key !== req.key; }));
    return { ok: true, warning: lockedWarning_(res.locked) };
  });
}

function actionDismissZoom_(req) {
  return withLock_(function () {
    const alerts = readJsonProp_(ZOOM_ALERTS_KEY_, []);
    writeJsonProp_(ZOOM_ALERTS_KEY_, alerts.filter(function (x) { return x.key !== req.key; }));
    return { ok: true };
  });
}
