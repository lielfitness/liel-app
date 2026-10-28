/**
 * בריאות המערכת: כמה זמן רצים הטריגרים (מכסה של גוגל: 90 דק׳ ביום) ומתי כל אחד רץ לאחרונה.
 * במסך הבית מוצגת שורת אזהרה רק אם משהו לא תקין. הפרטים המלאים – במסך נסתר.
 */
const RUN_LABELS_ = { zoom: 'סריקת זומים', watch: 'בדיקת לידים חדשים', edit: 'עריכה בגיליון' };
const QUOTA_MIN_ = 90, QUOTA_WARN_MIN_ = 60;
const FIN_LABELS_ = { ccHourly: 'קארדקום (כל שעה)', snapshot: 'מעקב ביטולים (כל שעה)', ccWatch: 'סיכום לטלגרם (כל 15 דק׳)', weeklyRun: 'הורדת פגישות' };

// זמן כל שלב בבדיקה של כל דקה (לפילוח הצריכה)
let WATCH_PH_ = {};
function step_(name, fn) {
  const t = Date.now();
  try { return fn(); } catch (e) { console.warn(name + ': ' + e); }
  finally { WATCH_PH_[name] = (WATCH_PH_[name] || 0) + (Date.now() - t); }
}

function trackRun_(name, t0) {
  try {
    const s = readJsonProp_('RUN_STATS', {});
    const day = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
    if (s.day !== day) {
      if (s.day) s.prev = { day: s.day, ms: s.ms };
      s.day = day; s.ms = 0; s.by = {}; s.ph = {}; s.quick = 0;
    }
    const ms = Date.now() - t0;
    s.ms = (s.ms || 0) + ms;
    s.by = s.by || {};
    const b = s.by[name] || (s.by[name] = { runs: 0, ms: 0 });
    b.runs++; b.ms += ms;
    if (name === 'watch') {
      if (!s.ph) { s.ph = {}; s.phSince = Utilities.formatDate(new Date(), TZ_, 'HH:mm'); }
      Object.keys(WATCH_PH_).forEach(function (k) { if (k !== 'noChange') s.ph[k] = (s.ph[k] || 0) + WATCH_PH_[k]; });
      if (WATCH_PH_.noChange) s.quick = (s.quick || 0) + 1;
      WATCH_PH_ = {};
    }
    s.last = s.last || {};
    s.last[name] = Date.now();
    writeJsonProp_('RUN_STATS', s);
  } catch (e) { /* לא קריטי */ }
}

/** בעיות פעילות (ריק = הכל תקין) + פרטים למסך הנסתר */
function healthCheck_() {
  const props = PropertiesService.getScriptProperties();
  const s = readJsonProp_('RUN_STATS', {});
  const today = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
  // כולל את הסקריפט של הפיננסים – אותו חשבון, אותה מכסה (נקרא פעם בשעה מה-Web App שלו)
  const fin = readJsonProp_('FIN_USAGE', null);
  const finMs = fin && fin.day === today ? fin.ms || 0 : 0;
  const usedMin = ((s.day === today ? s.ms || 0 : 0) + finMs) / 60000;
  const triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  const watchMin = Number(props.getProperty('WATCH_MINUTES') || 1);
  const last = s.last || {};
  const ago = function (t) { return t ? Math.round((Date.now() - t) / 60000) : null; };
  const issues = [];

  const calWrite = hasCalendarWrite_();
  if (!calWrite) issues.push('אין הרשאת כתיבה ליומן – ביטול/שינוי מועד מהאפליקציה לא יעבדו');

  const watchLimit = Math.max(15, watchMin * 2 + 5);
  if (triggers.indexOf('watchNewLeads') < 0) issues.push('הבדיקה של לידים חדשים כבויה');
  else if (last.watch && ago(last.watch) > watchLimit) issues.push('הבדיקה של לידים חדשים לא רצה ' + ago(last.watch) + ' דק׳');

  if (triggers.indexOf('scanZoomBookings') < 0) issues.push('סריקת הזומים כבויה');
  else if (last.zoom && ago(last.zoom) > 45) issues.push('סריקת הזומים לא רצה ' + ago(last.zoom) + ' דק׳');

  if (!props.getProperty('FCM_SERVICE_ACCOUNT')) issues.push('Push לטלפון לא מוגדר');
  if (usedMin > QUOTA_WARN_MIN_) issues.push('שימוש יומי בטריגרים: ' + Math.round(usedMin) + ' מתוך ' + QUOTA_MIN_ + ' דק׳');

  const by = s.day === today ? (s.by || {}) : {};
  return {
    issues: issues,
    details: {
      calendarWrite: calWrite,
      calTrigger: props.getProperty('CAL_TRIGGER') || 'לא הותקן',
      zoomLast: readJsonProp_('ZOOM_LAST', null),
      watchMinutes: watchMin,
      push: !!props.getProperty('FCM_SERVICE_ACCOUNT'),
      triggers: triggers,
      usedMin: Math.round(usedMin * 10) / 10,
      prevDay: s.prev || null,
      runs: Object.keys(RUN_LABELS_).map(function (k) {
        const b = by[k] || { runs: 0, ms: 0 };
        return { k: k, label: RUN_LABELS_[k], runs: b.runs, avgMs: b.runs ? Math.round(b.ms / b.runs) : 0, totalMin: Math.round(b.ms / 6000) / 10, last: last[k] || null };
      }).concat(Object.keys(fin && fin.day === today ? fin.by || {} : {}).map(function (k) {
        const b = fin.by[k];
        return { k: 'fin:' + k, label: 'פיננסים – ' + (FIN_LABELS_[k] || k), runs: b.runs, avgMs: b.runs ? Math.round(b.ms / b.runs) : 0, totalMin: Math.round(b.ms / 6000) / 10, last: null };
      })),
    },
  };
}

// ---------- פעם בשעה: שורה בלשונית "שימוש טריגרים" בגיליון המערכת (לבדיקה ולמעקב) ----------
// כולל את הסקריפט של הפיננסים (אותו חשבון = אותה מכסה של 90 דק׳), שמדווח את הזמן שלו דרך ה-Web App שלו.
function usageDump_() {
  const props = PropertiesService.getScriptProperties();
  // פעם אחת: סריקת הזומים (גיבוי) כל 30 דק׳ במקום 10 – שינוי ביומן עדיין מעדכן מיד (onCalendarChange)
  if (props.getProperty('ZOOM_EVERY') !== '30') {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'scanZoomBookings') ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('scanZoomBookings').timeBased().everyMinutes(30).create();
    props.setProperty('ZOOM_EVERY', '30');
  }
  const hour = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd HH');
  if (props.getProperty('USAGE_HOUR') === hour) return;
  props.setProperty('USAGE_HOUR', hour);
  let fin = null;
  try { fin = finCall_('usage'); writeJsonProp_('FIN_USAGE', fin); } catch (e) { console.warn('fin usage: ' + e); }
  const s = readJsonProp_('RUN_STATS', {});
  const by = s.by || {};
  const fmt = function (b) { return b ? b.runs + ' ריצות · ממוצע ' + (b.runs ? Math.round(b.ms / b.runs) : 0) + 'ms · ' + Math.round(b.ms / 6000) / 10 + ' דק׳' : '—'; };
  const ph = Object.keys(s.ph || {}).sort(function (a, b) { return s.ph[b] - s.ph[a]; })
    .map(function (k) { return k + ' ' + Math.round(s.ph[k] / 100) / 10 + 'ש׳'; }).join(' · ') + ' (מאז ' + (s.phSince || '?') + ')';
  const finBy = fin && fin.day === s.day ? fin.by || {} : {};
  const finMs = fin && fin.day === s.day ? fin.ms || 0 : 0;
  sysTab_('usage').appendRow([Utilities.formatDate(new Date(), TZ_, 'dd/MM HH:mm'), Math.round((s.ms || 0) / 6000) / 10, Math.round(finMs / 6000) / 10,
    fmt(by.watch), (s.quick || 0) + ' יצאו מוקדם', fmt(by.zoom), fmt(by.edit), ph,
    Object.keys(finBy).map(function (k) { return k + ': ' + fmt(finBy[k]); }).join(' | '), s.prev ? s.prev.day + ': ' + Math.round(s.prev.ms / 6000) / 10 + ' דק׳' : '']);
}
