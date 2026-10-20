/**
 * שליחת הודעה לליאל דרך הבוט הקיים (sendMessage בלבד).
 * לא קוראים ל-getUpdates / setWebhook – כדי לא להפריע לבוט הקיים.
 * הטוקן נקרא מ-Script Properties ולא נרשם ללוג.
 */
function sendTelegram_(html, buttons) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = p.getProperty('TELEGRAM_CHAT_ID') || getConfig_().telegramChatId;
  if (!token || !chatId) { console.warn('טלגרם לא מוגדר (TELEGRAM_BOT_TOKEN) – ההודעה לא נשלחה'); return false; }
  const body = { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
  if (buttons && buttons.length) body.reply_markup = { inline_keyboard: [buttons] };
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.warn('טלגרם החזיר ' + res.getResponseCode());
    return false;
  }
  return true;
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
