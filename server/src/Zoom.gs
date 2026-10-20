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

function bookerInfo_(ev, cfg) {
  const skip = Object.keys(cfg.users);
  const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const emails = {};
  ev.getGuestList().forEach(function (g) {
    const e = String(g.getEmail() || '').toLowerCase();
    if (e && e !== me && skip.indexOf(e) < 0) emails[e] = 1;
  });
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
  return {
    emails: Object.keys(emails),
    phones: Object.keys(phones),
    name: nm ? nm[1].trim() : title.replace(ZOOM_TITLE_, '').replace(/[-–:|]/g, ' ').trim(),
  };
}

function matchLead_(leads, info) {
  const hits = leads.filter(function (l) {
    const em = String(l.email || '').trim().toLowerCase();
    return (em && info.emails.indexOf(em) >= 0) || (phoneKey_(l.phone) && info.phones.indexOf(phoneKey_(l.phone)) >= 0);
  });
  if (!hits.length) return null;
  // אם יש כמה (ליד שנכנס פעמיים) – הכי חדש
  return hits.sort(function (a, b) { return b.row - a.row; })[0];
}

function fmtWhen_(d) {
  return Utilities.formatDate(d, TZ_, 'dd/MM/yyyy HH:mm');
}

/** הטריגר (כל 10 דקות). */
function scanZoomBookings() {
  const cfg = getConfig_();
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
      const lead = matchLead_(r.leads, info);
      const iso = isoDate_(new Date(start.getFullYear(), start.getMonth(), start.getDate()));

      if (lead && (!lead.zoomDate || lead.zoomDate === iso)) {
        if (!lead.zoomDate) setDateCell_(r.sh, lead.row, COL_.zoomDate, parseIso_(iso));
        if (!isFinal_(lead.status) && lead.status !== 'זום נקבע') r.sh.getRange(lead.row, COL_.status).setValue('זום נקבע');
        touch_(r.sh, lead.row, r.upCol);
        SpreadsheetApp.flush();
        const r2 = readLeads_(cfg);
        syncRewards_(r2.sh, r2.leads, [iso.slice(0, 7)], false);
        sendTelegram_('📅 <b>זום חדש נקבע</b>\n' + esc_(lead.name) + '\n' + fmtWhen_(start),
          [{ text: 'פתח כרטיס ליד', url: appUrl + '#/lead/' + lead.id }]);
      } else {
        const reason = lead ? 'לליד כבר רשום תאריך זום אחר (' + fmtDate_(parseIso_(lead.zoomDate)) + ')' : 'לא נמצא ליד עם המייל/הטלפון של המזמין';
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
