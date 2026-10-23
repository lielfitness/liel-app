/**
 * בריאות המערכת: כמה זמן רצים הטריגרים (מכסה של גוגל: 90 דק׳ ביום) ומתי כל אחד רץ לאחרונה.
 * במסך הבית מוצגת שורת אזהרה רק אם משהו לא תקין. הפרטים המלאים – במסך נסתר.
 */
const RUN_LABELS_ = { zoom: 'סריקת זומים', watch: 'בדיקת לידים חדשים', edit: 'עריכה בגיליון' };
const QUOTA_MIN_ = 90, QUOTA_WARN_MIN_ = 60;

function trackRun_(name, t0) {
  try {
    const s = readJsonProp_('RUN_STATS', {});
    const day = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
    if (s.day !== day) {
      if (s.day) s.prev = { day: s.day, ms: s.ms };
      s.day = day; s.ms = 0; s.by = {};
    }
    const ms = Date.now() - t0;
    s.ms = (s.ms || 0) + ms;
    s.by = s.by || {};
    const b = s.by[name] || (s.by[name] = { runs: 0, ms: 0 });
    b.runs++; b.ms += ms;
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
  const usedMin = s.day === today ? (s.ms || 0) / 60000 : 0;
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
  else if (last.zoom && ago(last.zoom) > 15) issues.push('סריקת הזומים לא רצה ' + ago(last.zoom) + ' דק׳');

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
      }),
    },
  };
}
