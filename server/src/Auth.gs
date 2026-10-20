/**
 * אימות: כניסה עם גוגל פעם אחת (ID token נבדק מול tokeninfo),
 * ואז השרת מנפיק סשן חתום ל-30 יום, כדי שלא יצטרכו להתחבר מחדש כל שעה.
 * התפקיד נבדק מחדש בכל קריאה מול CONFIG.users, אז הסרת משתמש חלה מיד.
 */

const SESSION_DAYS_ = 30;

function verifyIdToken_(idToken, clientId) {
  if (!idToken) throw apiError_('AUTH', 'חסר טוקן כניסה');
  if (!clientId) throw apiError_('CONFIG', 'חסר clientId ב-CONFIG');
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw apiError_('AUTH', 'הכניסה עם גוגל לא אומתה');
  const t = JSON.parse(res.getContentText());
  const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  const verified = t.email_verified === true || t.email_verified === 'true';
  if (t.aud !== clientId || !issOk || !verified || Number(t.exp) * 1000 < Date.now()) {
    throw apiError_('AUTH', 'הכניסה עם גוגל לא אומתה');
  }
  return String(t.email).toLowerCase();
}

function sessionSecret_() {
  const s = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  if (!s) throw apiError_('CONFIG', 'צריך להריץ setup() פעם אחת');
  return s;
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, sessionSecret_())).replace(/=+$/, '');
}

function makeSession_(email) {
  const payload = email + '|' + (Date.now() + SESSION_DAYS_ * 864e5);
  return Utilities.base64EncodeWebSafe(payload, Utilities.Charset.UTF_8).replace(/=+$/, '') +
    '.' + sign_(payload);
}

function checkSession_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw apiError_('AUTH', 'צריך להתחבר');
  let payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (e) {
    throw apiError_('AUTH', 'צריך להתחבר');
  }
  if (!safeEqual_(sign_(payload), parts[1])) throw apiError_('AUTH', 'צריך להתחבר');
  const i = payload.lastIndexOf('|');
  if (Number(payload.slice(i + 1)) < Date.now()) throw apiError_('AUTH', 'החיבור פג, צריך להתחבר שוב');
  return payload.slice(0, i);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
