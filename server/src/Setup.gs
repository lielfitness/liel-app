/**
 * התקנה – ליאל מריץ פעם אחת מהעורך (Run → setup).
 * לא משנה שום גיליון. רק: סוד לסשנים, טריגרים של הפרויקט הזה, וסימון הזומים הקיימים כ"נראו".
 * אפשר להריץ שוב בבטחה – לא יוצר טריגרים כפולים.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const cfg = getConfig_();
  const log = [];

  ['leadsSheetId', 'finSheetId', 'appUrl'].forEach(function (k) {
    if (!cfg[k]) throw new Error('חסר "' + k + '" בהגדרות');
  });
  if (!cfg.clientId) log.push('⚠️ עדיין אין clientId – הכניסה לאפליקציה לא תעבוד עד שיתווסף');
  log.push('משתמשים: ' + Object.keys(cfg.users).length);

  if (!props.getProperty('SESSION_SECRET')) {
    props.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
    log.push('נוצר SESSION_SECRET');
  }

  // בדיקת גישה לגיליונות (קריאה בלבד)
  const leads = readLeads_(cfg);
  log.push('לידים שנקראו: ' + leads.leads.length + (leads.upCol ? ' | עמודת "עודכן לאחרונה": קיימת' : ' | עמודת "עודכן לאחרונה": עדיין לא קיימת'));
  SpreadsheetApp.openById(cfg.finSheetId).getName();
  log.push('גיליון פיננסים: נגיש');

  const triggers = ScriptApp.getProjectTriggers();
  const has = function (fn) { return triggers.some(function (t) { return t.getHandlerFunction() === fn; }); };

  if (!props.getProperty(ZOOM_SEEN_KEY_)) {
    log.push('זומים קיימים שסומנו כ"נראו" (לא ייכתבו/יישלחו): ' + seedZoomSeen_());
  }
  if (!has('scanZoomBookings')) {
    ScriptApp.newTrigger('scanZoomBookings').timeBased().everyMinutes(10).create();
    log.push('נוצר טריגר: סריקת זומים כל 10 דקות');
  }
  if (!has('onLeadsEdit')) {
    ScriptApp.newTrigger('onLeadsEdit').forSpreadsheet(cfg.leadsSheetId).onEdit().create();
    log.push('נוצר טריגר: עריכה ידנית בגיליון הלידים → "עודכן לאחרונה"');
  }

  const tg = props.getProperty('TELEGRAM_BOT_TOKEN') && (props.getProperty('TELEGRAM_CHAT_ID') || cfg.telegramChatId);
  log.push(tg ? 'טלגרם: מוגדר' : 'טלגרם: עדיין לא מוגדר (חסר TELEGRAM_BOT_TOKEN)');

  console.log('✅ setup הסתיים\n' + log.join('\n'));
}

/** שולח הודעת בדיקה לטלגרם (להרצה ידנית מהעורך). */
function testTelegram() {
  const ok = sendTelegram_('✅ בדיקה מאפליקציית Liel Fitness – ההתראות על זום חדש יגיעו לכאן.',
    [{ text: 'פתח את האפליקציה', url: getConfig_().appUrl }]);
  console.log(ok ? 'נשלח' : 'לא נשלח – בדוק את TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
}

/** מדידת מהירות (קריאה בלבד – לא כותב לגיליון). להרצה ידנית מהעורך. */
function benchmarkSpeed() {
  const cfg = getConfig_();
  const time = function (fn) { const t = Date.now(); fn(); return Date.now() - t; };
  let r;
  const fullRead1 = time(function () { r = readLeads_(cfg); });
  const fullRead2 = time(function () { readLeads_(cfg); });
  const last = r.leads[r.leads.length - 1];
  invalidateLeads_();
  const cacheMiss = time(function () { cachedLeads_(cfg); });
  const cacheHit = time(function () { cachedLeads_(cfg); });
  const sh = leadsSheet_(cfg), ex = extraCols_(sh);
  const rowRead = time(function () { readLeadAt_(sh, ex, last.row); readLeadAt_(sh, ex, last.row); });
  console.log([
    '⏱ מדידת שרת (מילישניות), ' + r.leads.length + ' לידים',
    'טעינת רשימה – לפני (קריאה מלאה מהגיליון): ' + fullRead1 + ' / ' + fullRead2,
    'טעינת רשימה – אחרי, בפעם הראשונה (קריאה + שמירה במטמון): ' + cacheMiss,
    'טעינת רשימה – אחרי, מהמטמון: ' + cacheHit,
    'שמירה – לפני (2 קריאות מלאות סביב הכתיבה): ~' + (fullRead1 + fullRead2),
    'שמירה – אחרי (2 קריאות של שורה בלבד): ' + rowRead,
  ].join('\n'));
}

/** להרצה ידנית מהעורך: מוחק ומתקין מחדש את הטריגרים של הפרויקט הזה (אחרי שינוי הרשאות). */
function reinstallTriggers() {
  const cfg = getConfig_();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('scanZoomBookings').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onLeadsEdit').forSpreadsheet(cfg.leadsSheetId).onEdit().create();
  ScriptApp.newTrigger('watchNewLeads').timeBased().everyMinutes(Number(PropertiesService.getScriptProperties().getProperty('WATCH_MINUTES') || 1)).create();
  PropertiesService.getScriptProperties().deleteProperty('CAL_TRIGGER');
  const st = ensureCalendarTrigger_(true);
  console.log('✅ הטריגרים הותקנו מחדש: סריקת זומים כל 10 דק׳, עריכה בגיליון, שינוי ביומן (' + st + '), בדיקת לידים חדשים');
  console.log(hasCalendarWrite_() ? '✅ יש הרשאת כתיבה ליומן' : '❌ אין הרשאת כתיבה ליומן');
}
