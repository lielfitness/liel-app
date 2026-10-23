/**
 * שלב 2 – פגישות מאמנים ופיננסים (ליאל בלבד).
 * פעולות שמשנות את D בגיליון תפעול (לחייב / חידוש / הרץ עכשיו) עוברות דרך סקריפט הפגישות עצמו
 * (AppApi.js בפרויקט של גיליון הפיננסים) – אותה לוגיקה ואותה נעילה כמו בגיליון.
 */

/** קריאה ל-Web App של סקריפט הפגישות */
function finCall_(action, params) {
  const cfg = getConfig_();
  const key = PropertiesService.getScriptProperties().getProperty('FINANCE_KEY');
  if (!cfg.financeApiUrl || !key) throw apiError_('CONFIG', 'החיבור לסקריפט הפגישות עוד לא הוגדר (FINANCE_KEY)');
  const res = UrlFetchApp.fetch(cfg.financeApiUrl, {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ action: action, key: key }, params || {})),
  });
  let out;
  try { out = JSON.parse(res.getContentText()); } catch (e) { throw apiError_('ERROR', 'סקריפט הפגישות לא ענה כמו שצריך (' + res.getResponseCode() + ')'); }
  if (!out.ok) throw apiError_(out.error === 'FORBIDDEN' ? 'CONFIG' : 'ERROR', out.error === 'FORBIDDEN' ? 'המפתח FINANCE_KEY לא תואם ל-APP_KEY בסקריפט הפגישות' : out.error);
  return out.data;
}

/** להרצה ידנית מהעורך: בודק את החיבור לסקריפט הפגישות (בלי לשנות כלום) */
function checkFinanceLink() {
  try {
    const d = finCall_('ping');
    console.log(d.sheet ? '✅ החיבור לסקריפט הפגישות תקין – הגיליון: ' + d.sheet
      : '⚠️ החיבור תקין, אבל הסקריפט לא מוצא את הגיליון כשהוא רץ כ-Web App – צריך תיקון לפני שממשיכים');
  } catch (e) {
    console.log('❌ ' + e.message);
  }
}
