/**
 * קביעת זום: סריקת אירועי "פגישת אפיון" ביומן של ליאל (טריגר כל 10 דק').
 * - התאמה ודאית לליד (מייל/טלפון) → ממלא R (תאריך זום) ו-N = "זום נקבע", ושולח לליאל הודעה בטלגרם.
 * - אין התאמה / לליד כבר יש תאריך זום אחר → נשמר כהתראה באפליקציה לשיוך ידני (+ הודעה בטלגרם).
 * לא דורס תאריך זום שכבר מולא. בהרצה הראשונה רק מסמן את האירועים הקיימים כ"נראו" (בלי לכתוב כלום).
 */

const ZOOM_TITLE_ = 'פגישת אפיון';
const ZOOM_SEEN_KEY_ = 'ZOOM_SEEN';
const ZOOM_ALERTS_KEY_ = 'ZOOM_ALERTS';
const ZOOM_LINKS_KEY_ = 'ZOOM_LINKS';   // מזהה אירוע ביומן → הליד ששויך אליו (לזיהוי ביטולים והזזות)

function eventIdOfKey_(key) { return String(key || '').split('|')[0]; }

function linkZoom_(links, evId, lead, startMs, iso) {
  links[evId] = { leadId: lead.id, row: lead.row, name: lead.name, start: startMs, iso: iso };
}

/** קישורים לפגישות שכבר עברו לא נחוצים יותר. */
function pruneLinks_(links) {
  const cutoff = Date.now() - 2 * DAY_MS_;
  Object.keys(links).forEach(function (k) { if (!links[k] || links[k].start < cutoff) delete links[k]; });
  return links;
}

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
    const links = pruneLinks_(readJsonProp_(ZOOM_LINKS_KEY_, {}));
    const all = zoomEvents_(cfg);
    const present = {};
    all.forEach(function (ev) { present[ev.getId()] = ev; });
    const events = all.filter(function (ev) { return !seen[eventKey_(ev)]; });
    // פגישה עתידית ששויכה לליד ונעלמה מהיומן = בוטלה
    // חד-פעמי: קישור פגישות עתידיות שכבר היו ביומן לפני שהקישור נוסף (בלי לכתוב לגיליון)
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('ZOOM_LINKS_BACKFILL')) {
      const rb = readLeads_(cfg);
      all.forEach(function (ev) {
        if (links[ev.getId()] || ev.getStartTime().getTime() < Date.now()) return;
        const st = ev.getStartTime();
        const isoB = isoDate_(new Date(st.getFullYear(), st.getMonth(), st.getDate()));
        const m = matchLead_(rb.leads, bookerInfo_(ev, cfg));
        if (m.lead && m.lead.zoomDate === isoB) linkZoom_(links, ev.getId(), m.lead, st.getTime(), isoB);
      });
      props.setProperty('ZOOM_LINKS_BACKFILL', String(Object.keys(links).length));
    }
    // מועמדים לביטול: פגישה עתידית שנעלמה מרשימת האירועים (מקושרת לליד, או שנראתה בסריקה קודמת).
    // הערה: ביטול ביומן גוגל לא מוחק את האירוע לגמרי – getEventById עדיין מחזיר אותו, אבל getEvents כבר לא.
    const done = readJsonProp_('ZOOM_CANCEL_DONE', {});
    Object.keys(done).forEach(function (k) { if (done[k] < Date.now() - 30 * DAY_MS_) delete done[k]; });
    const candidates = {};
    Object.keys(links).forEach(function (id) {
      if (!present[id] && links[id].start > Date.now()) candidates[id] = { link: links[id], start: links[id].start };
    });
    Object.keys(seen).forEach(function (k) {
      const id = eventIdOfKey_(k);
      if (!present[id] && seen[k] > Date.now() && !candidates[id] && !done[id]) candidates[id] = { link: null, start: seen[k] };
    });
    const cancelled = Object.keys(candidates);
    scanLog_({ via: via === 'calendar' ? 'calendar' : (via === 'manual' ? 'manual' : 'timer'), events: all.length, newEvents: events.length,
      links: Object.keys(links).length, candidates: cancelled.length });
    if (!events.length && !cancelled.length) { writeJsonProp_(ZOOM_SEEN_KEY_, seen); writeJsonProp_(ZOOM_LINKS_KEY_, links); return; }

    let r = readLeads_(cfg);
    const alerts = readJsonProp_(ZOOM_ALERTS_KEY_, []);
    const appUrl = String(cfg.appUrl || '').replace(/\/?$/, '/');
    const findLead = function (link) {
      return r.leads.filter(function (l) { return l.id === link.leadId; })[0] || null;
    };

    // ---- ביטולים ----
    cancelled.forEach(function (id) {
      const c = candidates[id];
      let ev = null;
      try { ev = zoomCalendar_(cfg).getEventById(id); } catch (e) { ev = null; }
      // הכותרת כבר לא "פגישת אפיון" → לא ביטול, רק לא רלוונטי יותר
      if (ev && String(ev.getTitle()).indexOf(ZOOM_TITLE_) < 0) { delete links[id]; done[id] = Date.now(); return; }
      let link = c.link;
      if (!link) {
        // לא היה קישור (פגישה מלפני שהקישור נוסף): מתאימים לליד רק אם תאריך הזום שלו הוא בדיוק של הפגישה
        if (!ev) { done[id] = Date.now(); return; }
        const m = matchLead_(r.leads, bookerInfo_(ev, cfg));
        const s0 = new Date(c.start);
        const iso0 = isoDate_(new Date(s0.getFullYear(), s0.getMonth(), s0.getDate()));
        if (!m.lead || m.lead.zoomDate !== iso0) { done[id] = Date.now(); return; }
        link = { leadId: m.lead.id, row: m.lead.row, name: m.lead.name, start: c.start, iso: iso0 };
      }
      delete links[id];
      done[id] = Date.now();
      scanLog_({ cancel: link.name, iso: link.iso, eventFound: !!ev });
      const lead = findLead(link);
      const btn = lead ? [{ text: 'פתח כרטיס ליד', url: appUrl + '#/lead/' + lead.id }] : [];
      if (!lead) {
        sendTelegram_('❌ <b>זום בוטל – ' + esc_(link.name) + '</b>\n' + fmtWhen_(new Date(link.start)) + '\nהליד לא נמצא בגיליון – לא שיניתי כלום', btn);
        return;
      }
      if (String(lead.zoomResult || '').trim()) {
        sendTelegram_('❌ <b>זום בוטל – ' + esc_(lead.name) + '</b>\n' + fmtWhen_(new Date(link.start)) +
          '\nכבר יש תוצאת זום ("' + esc_(lead.zoomResult) + '") – לא שיניתי כלום', btn);
        return;
      }
      if (lead.zoomDate && lead.zoomDate !== link.iso) {
        sendTelegram_('❌ <b>זום בוטל – ' + esc_(lead.name) + '</b>\n' + fmtWhen_(new Date(link.start)) +
          '\nבגיליון רשום תאריך זום אחר (' + fmtDate_(parseIso_(lead.zoomDate)) + ') – לא שיניתי כלום', btn);
        return;
      }
      setDateCell_(r.sh, lead.row, COL_.zoomDate, null);
      const newStatus = !isFinal_(lead.status) ? 'פגישה בוטלה' : '';   // סטטוס סופי (לא מעוניין וכו') לא נדרס
      if (newStatus) r.sh.getRange(lead.row, COL_.status).setValue(newStatus);
      if (String(lead.reward || '').trim() && !isLockedMonth_(link.iso.slice(0, 7))) r.sh.getRange(lead.row, COL_.reward).setValue('');
      touch_(r.sh, lead.row, r.upCol);
      SpreadsheetApp.flush();
      const r2 = readLeads_(cfg);
      syncRewards_(r2.sh, r2.leads, [link.iso.slice(0, 7)], false);
      r = readLeads_(cfg);
      sendTelegram_('❌ <b>זום בוטל – ' + esc_(lead.name) + '</b>\n' + fmtWhen_(new Date(link.start)) +
        '\nתאריך הזום נמחק' + (newStatus ? ' והסטטוס עבר ל"פגישה בוטלה"' : ' (הסטטוס "' + esc_(lead.status) + '" לא שונה)'), btn);
    });

    events.forEach(function (ev) {
      const key = eventKey_(ev);
      const start = ev.getStartTime();
      const iso = isoDate_(new Date(start.getFullYear(), start.getMonth(), start.getDate()));

      // ---- פגישה שהוזזה (אותו אירוע, שעה/יום אחרים) ----
      const prevLink = links[ev.getId()];
      if (prevLink && prevLink.start !== start.getTime()) {
        const pl = findLead(prevLink);
        if (pl && !String(pl.zoomResult || '').trim() && (!pl.zoomDate || pl.zoomDate === prevLink.iso)) {
          if (pl.zoomDate !== iso) setDateCell_(r.sh, pl.row, COL_.zoomDate, parseIso_(iso));
          touch_(r.sh, pl.row, r.upCol);
          SpreadsheetApp.flush();
          const r2 = readLeads_(cfg);
          syncRewards_(r2.sh, r2.leads, [prevLink.iso.slice(0, 7), iso.slice(0, 7)], false);
          linkZoom_(links, ev.getId(), pl, start.getTime(), iso);
          sendTelegram_('🔁 <b>זום הוזז – ' + esc_(pl.name) + '</b>\n' + fmtWhen_(new Date(prevLink.start)) + ' ← ' + fmtWhen_(start),
            [{ text: 'פתח כרטיס ליד', url: appUrl + '#/lead/' + pl.id }]);
          seen[key] = start.getTime();
          return;
        }
      }

      const info = bookerInfo_(ev, cfg);
      const match = matchLead_(r.leads, info);
      const lead = match.lead;

      if (lead && (!lead.zoomDate || lead.zoomDate === iso)) {
        linkZoom_(links, ev.getId(), lead, start.getTime(), iso);
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
    writeJsonProp_(ZOOM_LINKS_KEY_, links);
    writeJsonProp_('ZOOM_CANCEL_DONE', done);
  });
}

/** יומן קצר של הסריקות האחרונות (לאבחון). */
function scanLog_(entry) {
  const log = readJsonProp_('ZOOM_SCAN_LOG', []);
  entry.t = Utilities.formatDate(new Date(), TZ_, 'dd/MM HH:mm:ss');
  log.push(entry);
  writeJsonProp_('ZOOM_SCAN_LOG', log.slice(-20));
}

/** להרצה ידנית מהעורך: מה הסריקה רואה – קישורים, אירועים, ואיך אירוע שבוטל נראה. לא משנה כלום. */
function zoomDiagnostics() {
  const cfg = getConfig_();
  const props = PropertiesService.getScriptProperties();
  const out = [];
  out.push('טריגרים: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + '/' + t.getEventType(); }).join(', '));
  out.push('CAL_TRIGGER=' + props.getProperty('CAL_TRIGGER') + ' | BACKFILL=' + props.getProperty('ZOOM_LINKS_BACKFILL'));
  const links = readJsonProp_(ZOOM_LINKS_KEY_, {});
  out.push('קישורים (' + Object.keys(links).length + '): ' + Object.keys(links).map(function (k) { return links[k].name + ' ' + links[k].iso; }).join(' | '));
  const all = zoomEvents_(cfg);
  const present = {};
  all.forEach(function (ev) { present[ev.getId()] = 1; });
  out.push('אירועי "' + ZOOM_TITLE_ + '" ביומן עכשיו: ' + all.map(function (ev) { return fmtWhen_(ev.getStartTime()) + ' ' + ev.getTitle(); }).join(' | '));
  const seen = readJsonProp_(ZOOM_SEEN_KEY_, {});
  Object.keys(seen).forEach(function (k) {
    const id = eventIdOfKey_(k);
    if (present[id]) return;
    let ev = null, err = '';
    try { ev = zoomCalendar_(cfg).getEventById(id); } catch (e) { err = e.message; }
    out.push('נעלם מהרשימה: ' + fmtWhen_(new Date(seen[k])) + ' → getEventById: ' +
      (ev ? 'עדיין מחזיר אירוע ("' + ev.getTitle() + '", ' + fmtWhen_(ev.getStartTime()) + ')' : (err ? 'שגיאה: ' + err : 'null (נמחק לגמרי)')));
  });
  out.push('סריקות אחרונות: ' + JSON.stringify(readJsonProp_('ZOOM_SCAN_LOG', []).slice(-8)));
  console.log(out.join('\n'));
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
    const links = pruneLinks_(readJsonProp_(ZOOM_LINKS_KEY_, {}));
    linkZoom_(links, eventIdOfKey_(a.key), loc.lead, a.start, isoDate_(new Date(s.getFullYear(), s.getMonth(), s.getDate())));
    writeJsonProp_(ZOOM_LINKS_KEY_, links);
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
