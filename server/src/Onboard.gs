/**
 * שלב 3 – קליטת מאמן מתוך האפליקציה (ליאל בלבד).
 * לא משכפלים את הקליטה: האפליקציה שולחת תגובה לטופס "קליטת מאמן חדש לליווי",
 * והסקריפט המוצמד לטופס (onFormSubmit) עושה הכל כמו היום – Wix, קובץ, שיתוף, תפעול, טלגרם.
 * בסוף הוא כותב סטטוס ללשונית "קליטות (מערכת)" בגיליון התשובות, והבדיקה של כל דקה כאן קוראת אותו,
 * שולחת Push ומעדכנת את מספר הפגישות בתפעול אם ליאל בחר מספר אחר מברירת המחדל.
 */

const ONB_DEFAULT_ = { 'פרימיום': 12, 'בייסיק': 6 };
const ONB_TAB_ = 'קליטות (מערכת)';
const ONB_COLS_ = { at: 0, rid: 1, test: 2, name: 3, email: 4, phone: 5, track: 6, wix: 7, prog: 8, file: 9, share: 10, ops: 11, fileUrl: 12, wa: 13, errors: 14 };
const ONB_STEPS_ = [['wix', 'Wix'], ['prog', 'תכניות'], ['file', 'קובץ'], ['share', 'שיתוף'], ['ops', 'תפעול']];

function onbPhoneOk_(p) {
  const d = String(p || '').replace(/\D/g, '');
  const local = d.indexOf('972') === 0 ? '0' + d.slice(3) : d;
  return /^05\d{8}$/.test(local) || /^0[2-9]\d{7}$/.test(local);
}

/** שולח תגובה לטופס – כמו מישהו שמילא אותו. מחזיר את מזהה התגובה. */
function onbSubmit_(v) {
  const form = FormApp.openById(getConfig_().onboardFormId);
  const resp = form.createResponse();
  const byTitle = { 'מסלול': v.track, 'שם מלא': v.name, 'מייל': v.email, 'טלפון': v.phone };
  let filled = 0;
  form.getItems().forEach(function (it) {
    const val = byTitle[it.getTitle().trim()];
    if (val == null) return;
    const T = FormApp.ItemType;
    const t = it.getType();
    if (t === T.MULTIPLE_CHOICE) resp.withItemResponse(it.asMultipleChoiceItem().createResponse(val));
    else if (t === T.LIST) resp.withItemResponse(it.asListItem().createResponse(val));
    else if (t === T.TEXT) resp.withItemResponse(it.asTextItem().createResponse(val));
    else if (t === T.PARAGRAPH_TEXT) resp.withItemResponse(it.asParagraphTextItem().createResponse(val));
    else return;
    filled++;
  });
  if (filled < 4) throw apiError_('CONFIG', 'לא מצאתי בטופס את כל השדות (מסלול, שם מלא, מייל, טלפון) – אולי שמות השאלות השתנו');
  return resp.submit().getId();
}

function onbPending_() { return readJsonProp_('ONB_PENDING', []); }
function onbSavePending_(list) { writeJsonProp_('ONB_PENDING', list.slice(-20)); }

function actionOnboard_(req, ctx) {
  let v;
  if (req.test) {
    v = { track: 'בייסיק', name: 'בדיקת אפליקציה', email: 'app-test@example.com', phone: '0500000000', n: 6, test: true };
  } else {
    v = { track: String(req.track || ''), name: String(req.name || '').trim(), email: String(req.email || '').trim().toLowerCase(),
      phone: String(req.phone || '').trim(), n: Number(req.n) };
    if (!ONB_DEFAULT_[v.track]) throw apiError_('BAD_REQUEST', 'מסלול לא תקין');
    if (v.name.length < 2) throw apiError_('BAD_REQUEST', 'חסר שם מלא');
    if (/^בדיקת אפליקציה/.test(v.name)) throw apiError_('BAD_REQUEST', 'השם הזה שמור לבדיקה');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) throw apiError_('BAD_REQUEST', 'מייל לא תקין');
    if (!onbPhoneOk_(v.phone)) throw apiError_('BAD_REQUEST', 'טלפון ישראלי לא תקין');
    if (!(Number.isInteger(v.n) && v.n >= 1 && v.n <= 50)) throw apiError_('BAD_REQUEST', 'מספר פגישות צריך להיות שלם בין 1 ל-50');
    if (!req.rerun) {
      const exists = coachesData_(true).coaches.some(function (c) { return c.email.toLowerCase().split(/[,;\s]+/).indexOf(v.email) >= 0; });
      if (exists) return { exists: true, message: v.name + ' כבר ברשימת המאמנים (לפי המייל) – לא נקלט שוב' };
    }
  }
  const rid = onbSubmit_(v);
  const pend = onbPending_();
  pend.push(Object.assign({ rid: rid, at: Date.now(), rerun: !!req.rerun }, v));
  onbSavePending_(pend);
  return { rid: rid };
}

/** הרצה חוזרת של קליטה שנכשלה: אותם פרטים שוב. הסקריפט של הטופס מדלג על מה שכבר קיים (חבר באתר, תכניות, קובץ, תפעול). */
function actionOnboardRerun_(req, ctx) {
  const row = onbRows_().filter(function (r) { return r.rid === req.rid; })[0];
  if (!row) throw apiError_('NOT_FOUND', 'הקליטה לא נמצאה');
  if (row.test) return actionOnboard_({ test: true }, ctx);
  return actionOnboard_({ rerun: true, track: row.track, name: row.name, email: row.email, phone: row.phone, n: ONB_DEFAULT_[row.track] || 6 }, ctx);
}

function onbRows_() {
  const ss = SpreadsheetApp.openById(getConfig_().onboardSheetId);
  const sh = ss.getSheetByName(ONB_TAB_);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(sh.getLastRow() - 1, 40);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 15).getDisplayValues().map(function (r) {
    const steps = ONB_STEPS_.map(function (s) { return { k: s[0], label: s[1], value: r[ONB_COLS_[s[0]]] }; });
    const failed = steps.filter(function (s) { return /נכשל/.test(s.value); }).map(function (s) { return s.label; });
    return { at: r[0], rid: r[1], test: r[2] === 'כן', name: r[3], email: r[4], phone: r[5], track: r[6],
      steps: steps, failed: failed, fileUrl: r[12], wa: r[13], errors: r[14] };
  }).reverse();
}

function actionOnboardList_(req, ctx) {
  const rows = onbRows_();
  const pend = onbPending_().filter(function (p) { return !rows.some(function (r) { return r.rid === p.rid; }); })
    .map(function (p) { return { rid: p.rid, name: p.name, email: p.email, track: p.track, test: !!p.test, pending: true, at: Utilities.formatDate(new Date(p.at), TZ_, 'dd/MM/yyyy HH:mm') }; });
  return { items: pend.concat(rows).slice(0, 25) };
}

/** מתוך הבדיקה של כל דקה: קליטות שנשלחו מהאפליקציה ומחכות לסטטוס */
function pollOnboard_() {
  const pend = onbPending_();
  if (!pend.length) return;
  const rows = onbRows_();
  const keep = [];
  pend.forEach(function (p) {
    const r = rows.filter(function (x) { return x.rid === p.rid; })[0];
    if (!r) {
      if (Date.now() - p.at < 15 * 60000) { keep.push(p); return; }
      notify_('onboard', { title: '⚠️ קליטה של ' + p.name + ' – לא התקבלה תשובה מהטופס', text: 'בדקו בטלגרם / בגיליון התשובות', link: '#/onboard' }, { noQuiet: true });
      return;
    }
    // מספר פגישות שונה מברירת המחדל של המסלול → מעדכנים C ו-D בתפעול (רק אם הסקריפט הוסיף עכשיו שורה חדשה)
    let note = '';
    if (!r.test && !r.failed.length && p.n && p.n !== ONB_DEFAULT_[p.track] && /^נוסף/.test(r.steps[4].value)) {
      try { note = onbSetPackage_(p.email, p.n); } catch (e) { note = ' · ⚠️ לא עדכנתי את מספר הפגישות: ' + e.message; }
    }
    const title = r.failed.length ? '⚠️ קליטה של ' + r.name + ' נכשלה בשלב ' + r.failed.join(', ') : '✅ ' + r.name + ' נקלט/ה' + (r.test ? ' (בדיקה)' : '');
    notify_('onboard', { title: title, text: r.test ? 'מצב בדיקה – בלי Wix ובלי קבצים' : (r.track + note), link: '#/onboard' }, { noQuiet: true });
    if (r.test) { try { FormApp.openById(getConfig_().onboardFormId).deleteResponse(p.rid); } catch (e) { /* */ } }
  });
  onbSavePending_(keep);
}

function onbSetPackage_(email, n) {
  return finLock_(function () {
    const sh = finTab_(finSs_(), 'coaches');
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][1]).toLowerCase().split(/[,;\s]+/).indexOf(email) >= 0) {
        sh.getRange(i + 2, 3, 1, 2).setValues([[n, n]]);
        CacheService.getScriptCache().remove('coach_v1');
        return ' · ' + n + ' פגישות בחבילה';
      }
    }
    return ' · ⚠️ לא מצאתי את המאמן בתפעול לעדכון מספר הפגישות';
  });
}

/** מסלול לכל מאמן (לפי המייל בתשובות הטופס) – לברירת המחדל של "חידוש" */
function onbTracks_() {
  const out = {};
  try {
    const sh = SpreadsheetApp.openById(getConfig_().onboardSheetId).getSheets()[0];
    if (sh.getLastRow() < 2) return out;
    const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    const h = vals[0].map(function (x) { return String(x).trim(); });
    const ct = h.indexOf('מסלול'), ce = h.indexOf('מייל');
    if (ct < 0 || ce < 0) return out;
    vals.slice(1).forEach(function (r) { const e = String(r[ce]).trim().toLowerCase(); if (e && ONB_DEFAULT_[r[ct]]) out[e] = r[ct]; });
  } catch (e) { /* */ }
  return out;
}

/** להרצה פעם אחת מהעורך: מאשר את ההרשאה לטופס (חלון ההרשאות של גוגל) */
function authorizeForms() {
  const f = FormApp.openById(getConfig_().onboardFormId);
  console.log('✅ יש גישה לטופס: ' + f.getTitle() + ' (' + f.getItems().length + ' שאלות)');
}
