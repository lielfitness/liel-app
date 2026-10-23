/**
 * שליחת הודעה לליאל דרך הבוט הקיים (sendMessage בלבד).
 * לא קוראים ל-getUpdates / setWebhook – כדי לא להפריע לבוט הקיים.
 * הטוקן נקרא מ-Script Properties ולא נרשם ללוג.
 */
/** התראות זום (נקבע / בוטל / הוזז) – רק לצ'אט הפרטי של ליאל. */
function sendTelegramLiel_(html, buttons) {
  return sendTelegram_(html, buttons, [getConfig_().telegramChatId]);
}

/** ליד חדש – לליאל ולשי (אם הוגדר הצ'אט של שי). */
function sendTelegramLeads_(html, buttons) {
  const cfg = getConfig_();
  return sendTelegram_(html, buttons, [cfg.telegramChatId, cfg.telegramShaiChatId].filter(Boolean));
}

function sendTelegram_(html, buttons, chatIds) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('TELEGRAM_BOT_TOKEN');
  const ids = chatIds && chatIds.length ? chatIds : [getConfig_().telegramChatId];
  if (!token || !ids.length) { console.warn('טלגרם לא מוגדר (TELEGRAM_BOT_TOKEN) – ההודעה לא נשלחה'); return false; }
  let ok = true;
  ids.forEach(function (chatId) { ok = sendTelegramOne_(token, chatId, html, buttons) && ok; });
  return ok;
}

function sendTelegramOne_(token, chatId, html, buttons) {
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
