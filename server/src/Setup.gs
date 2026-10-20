/**
 * התקנה – ליאל מריץ פעם אחת מהעורך (Run → setup).
 * לא משנה שום גיליון. רק: סוד לסשנים, טריגרים של הפרויקט הזה, וסימון הזומים הקיימים כ"נראו".
 * אפשר להריץ שוב בבטחה – לא יוצר טריגרים כפולים.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const cfg = getConfig_();
  const log = [];

  ['clientId', 'leadsSheetId', 'finSheetId', 'appUrl'].forEach(function (k) {
    if (!cfg[k]) throw new Error('חסר "' + k + '" ב-CONFIG');
  });
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

  const tg = props.getProperty('TELEGRAM_BOT_TOKEN') && props.getProperty('TELEGRAM_CHAT_ID');
  log.push(tg ? 'טלגרם: מוגדר' : 'טלגרם: עדיין לא מוגדר (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');

  console.log('✅ setup הסתיים\n' + log.join('\n'));
}

/** שולח הודעת בדיקה לטלגרם (להרצה ידנית מהעורך). */
function testTelegram() {
  const ok = sendTelegram_('✅ בדיקה מאפליקציית Liel Fitness – ההתראות על זום חדש יגיעו לכאן.',
    [{ text: 'פתח את האפליקציה', url: getConfig_().appUrl }]);
  console.log(ok ? 'נשלח' : 'לא נשלח – בדוק את TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
}
