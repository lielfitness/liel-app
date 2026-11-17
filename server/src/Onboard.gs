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
  notify_('onboard', { title: '⏳ קליטה של ' + v.name + ' בתהליך' + (v.test ? ' (בדיקה)' : ''), text: v.test ? 'מצב בדיקה – בלי Wix ובלי קבצים' : v.track, link: onbLink_(rid) },
    { noQuiet: true, noPush: true, replaceLink: true });
  CacheService.getScriptCache().remove(ONB_INFO_CACHE_);
  CacheService.getScriptCache().put('onb_hot', '1', 1800);   // בזמן שהקליטה רצה – הבדיקה של כל דקה מושכת את הסטטוס כל דקה
  return { rid: rid };
}

/** הרצה חוזרת של קליטה שנכשלה: אותם פרטים שוב. הסקריפט של הטופס מדלג על מה שכבר קיים (חבר באתר, תכניות, קובץ, תפעול). */
function actionOnboardRerun_(req, ctx) {
  const row = onbRows_().filter(function (r) { return r.rid === req.rid; })[0];
  if (!row) throw apiError_('NOT_FOUND', 'הקליטה לא נמצאה');
  if (row.test) return actionOnboard_({ test: true }, ctx);
  return actionOnboard_({ rerun: true, track: row.track, name: row.name, email: row.email, phone: row.phone, n: ONB_DEFAULT_[row.track] || 6 }, ctx);
}

// ---------- גיליון התשובות של טופס הקליטה: תמיד לפי הטופס, לא לפי ההגדרות (17/11/2026 – הגיליון הקודם נעלם) ----------
function onbSheetId_() {
  const c = CacheService.getScriptCache();
  const hit = c.get('onb_dest1');
  if (hit) return hit;
  let id = '';
  try { id = FormApp.openById(getConfig_().onboardFormId).getDestinationId(); } catch (e) { console.warn('form dest: ' + e); }
  id = id || getConfig_().onboardSheetId;
  c.put('onb_dest1', id, 3600);
  return id;
}
/** הגיליון עצמו. נכשל → שגיאה ברורה (לא מסתירים) */
function onbSs_() {
  try { return SpreadsheetApp.openById(onbSheetId_()); }
  catch (e) {
    CacheService.getScriptCache().remove('onb_dest1');
    throw apiError_('CONFIG', 'לא הצלחתי לפתוח את גיליון התשובות של טופס הקליטה (' + (e.message || e) + '). צריך לקשר את הטופס לגיליון: בטופס ← תשובות ← קישור ל-Sheets.');
  }
}
/** לשונית התשובות (זו שמקושרת לטופס), לא לשונית ריקה או "קליטות (מערכת)" */
function onbResponsesSheet_(ss) {
  return ss.getSheets().filter(function (x) { return x.getFormUrl && x.getFormUrl(); })[0] || ss.getSheets()[0];
}

function onbRows_() {
  const ss = onbSs_();
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
      notify_('onboard', { title: '⚠️ קליטה של ' + p.name + ' – לא התקבלה תשובה מהטופס', text: 'בדקו בטלגרם / בגיליון התשובות', link: onbLink_(p.rid) }, { noQuiet: true, noPush: true, replaceLink: true });
      return;
    }
    // מספר פגישות שונה מברירת המחדל של המסלול → מעדכנים C ו-D בתפעול (רק אם הסקריפט הוסיף עכשיו שורה חדשה)
    let note = '';
    if (!r.test && !r.failed.length && p.n && p.n !== ONB_DEFAULT_[p.track] && /^נוסף/.test(r.steps[4].value)) {
      try { note = onbSetPackage_(p.email, p.n); } catch (e) { note = ' · ⚠️ לא עדכנתי את מספר הפגישות: ' + e.message; }
    }
    const title = r.failed.length ? '⚠️ קליטה של ' + r.name + ' נכשלה בשלב ' + r.failed.join(', ') : '✅ ' + r.name + ' נקלט/ה' + (r.test ? ' (בדיקה)' : '');
    notify_('onboard', { title: title, text: r.test ? 'מצב בדיקה – בלי Wix ובלי קבצים' : (r.track + note), link: onbLink_(p.rid) }, { noQuiet: true, noPush: true, replaceLink: true });
    if (r.test) { try { FormApp.openById(getConfig_().onboardFormId).deleteResponse(p.rid); } catch (e) { /* */ } }
    else if (!r.failed.length) CacheService.getScriptCache().remove(COACH_CNT_CACHE_);   // נקלט – המונה מתעדכן מיד
  });
  onbSavePending_(keep);
  if (!keep.length) CacheService.getScriptCache().remove('onb_hot');
  CacheService.getScriptCache().remove(ONB_INFO_CACHE_);
}

// ---------- קליטות בפעמון (ליאל בלבד): כל קליטה = פריט אחד, עם כפתור ווטסאפ / קובץ / הרצה חוזרת ----------
const ONB_INFO_CACHE_ = 'onb_info_v1';
function onbLink_(rid) { return '#/onb/' + rid; }
/** מוסיף לכל התראת קליטה את מצב הקליטה מגיליון התשובות (נקרא פעם בדקה לכל היותר) */
function onbNotifInfo_(list) {
  if (!list.some(function (n) { return n.type === 'onboard'; })) return list;
  const cache = CacheService.getScriptCache();
  let rows = null;
  const hit = cache.get(ONB_INFO_CACHE_);
  if (hit) rows = JSON.parse(hit);
  else {
    rows = onbRows_().map(function (r) { return { rid: r.rid, name: r.name, email: r.email, track: r.track, test: r.test, failed: r.failed, wa: r.wa, fileUrl: r.fileUrl, errors: r.errors }; });
    try { cache.put(ONB_INFO_CACHE_, JSON.stringify(rows), 60); } catch (e) { /* */ }
  }
  const pend = onbPending_();
  return list.map(function (n) {
    if (n.type !== 'onboard') return n;
    const m = /^#\/onb\/(.+)$/.exec(n.link || '');
    let r = null, p = null;
    if (m) {
      r = rows.filter(function (x) { return x.rid === m[1]; })[0] || null;
      p = r ? null : pend.filter(function (x) { return x.rid === m[1]; })[0] || null;
    } else {
      // התראות מלפני השינוי (בלי מזהה): לפי השם שבכותרת – הקליטה האחרונה של אותו שם
      r = rows.filter(function (x) { return x.name && String(n.title).indexOf(x.name) >= 0; })[0] || null;
    }
    if (!r && !p) return n;
    const onb = r ? { rid: r.rid, name: r.name, test: r.test, failed: r.failed, wa: r.wa, fileUrl: r.fileUrl, errors: r.errors }
      : { rid: p.rid, name: p.name, test: !!p.test, pending: true };
    return Object.assign({}, n, { onb: onb });
  });
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
    const sh = onbResponsesSheet_(onbSs_());
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

// ---------- מונה "מאמנים ובוגרי ליווי" ----------
// בסיס: Script Property COACH_COUNT_BASE = {"count":110,"from":"<זמן ISO>"} (24/10/2026, לא משתנה).
// מעליו (17/11/2026): כל מאמן שקובץ "ליווי מקצועי - <שם>" (או "ליווי מקצועי פרימיום - <שם>") שלו נוצר בדרייב אחרי זמן הבסיס –
// קליטה מהטופס/מהאפליקציה וגם קליטה ידנית יוצרות את הקובץ. כל אדם נספר פעם אחת: שם שכבר היה לו קובץ לפני הבסיס,
// או קובץ שני לאותו שם – לא נספרים שוב. לא תלוי בגיליון התשובות.
// נכשל → { error } (האפליקציה מציגה הודעה במקום מספר). שמור 5 דקות, ומתאפס מיד אחרי קליטה מוצלחת.
const COACH_CNT_CACHE_ = 'coach_cnt1';
function coachCount_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(COACH_CNT_CACHE_);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* */ } }
  const base = readJsonProp_('COACH_COUNT_BASE', null);
  if (!base || !(Number(base.count) > 0) || isNaN(new Date(base.from).getTime())) return { error: 'חסר הבסיס של המונה (COACH_COUNT_BASE) – לא אפשר לספור' };
  const from = new Date(base.from).getTime();
  try {
    const before = {}, after = {};
    const it = DriveApp.searchFiles("title contains 'ליווי מקצועי' and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'");
    while (it.hasNext()) {
      const f = it.next();
      const m = String(f.getName()).match(/^ליווי מקצועי(?: פרימיום)?\s*-\s*(.+)$/);
      if (!m || /^(טמפלט|בדיקת)/.test(m[1].trim())) continue;
      const key = gapNorm_(m[1]);
      if (!key) continue;
      if (f.getDateCreated().getTime() <= from) before[key] = 1;
      else if (!after[key]) after[key] = m[1].trim();
    }
    const names = Object.keys(after).filter(function (k) { return !before[k]; }).map(function (k) { return after[k]; });
    const out = { total: Number(base.count) + names.length, base: Number(base.count), added: names.length, names: names };
    cache.put(COACH_CNT_CACHE_, JSON.stringify(out), 300);
    return out;
  } catch (e) {
    return { error: 'לא הצלחתי לספור את קבצי "ליווי מקצועי" בדרייב: ' + String(e.message || e).slice(0, 150) };
  }
}

// ---------- חד-פעמי (17/11/2026, באישור ליאל): קישור הטופס לגיליון תשובות חדש + בדיקת קליטה במצב בדיקה ----------
// רץ פעם אחת מהבדיקה של כל 5 דקות. רק אם גיליון היעד הנוכחי לא נפתח. התוצאה – ללשונית "קישור טופס הקליטה" בגיליון המערכת.
function onbRelinkOnce_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ONB_RELINK_DONE2')) return;   // ניסיון שני (הראשון נכשל: הטופס עוד היה מקושר לגיליון שנמחק)
  props.setProperty('ONB_RELINK_DONE2', new Date().toISOString());
  const log = [['זמן', Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy HH:mm')]];
  try {
    const form = FormApp.openById(getConfig_().onboardFormId);
    const old = form.getDestinationId();
    let ok = false;
    try { SpreadsheetApp.openById(old); ok = true; } catch (e) { log.push(['היעד הקודם', old + ' – לא נפתח: ' + (e.message || e)]); }
    if (ok) { log.push(['היעד הקודם', old + ' – נפתח, לא שיניתי כלום']); }
    else {
      // הגיליון שנוצר בניסיון הראשון (17/11) – משתמשים בו, לא יוצרים עוד אחד
      const name = form.getTitle() + ' (תשובות) – ' + Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy');
      const it = DriveApp.getFilesByName(name);
      let ss = null;
      while (it.hasNext() && !ss) { const f = it.next(); if (!f.isTrashed()) ss = SpreadsheetApp.openById(f.getId()); }
      if (!ss) { ss = SpreadsheetApp.create(name); ss.setSpreadsheetTimeZone(TZ_); }
      // קודם מנתקים את הקישור לגיליון שנמחק (בלי זה גוגל מסרבת: "הגדרת יעד התגובה נכשלה"). התשובות נשמרות בטופס.
      form.removeDestination();
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
      SpreadsheetApp.flush();
      CacheService.getScriptCache().removeAll(['onb_dest1', COACH_CNT_CACHE_]);
      log.push(['גיליון חדש', ss.getName() + ' · ' + ss.getUrl()]);
      log.push(['יעד הטופס עכשיו', form.getDestinationId() + (form.getDestinationId() === ss.getId() ? ' ✓' : ' ✗')]);
    }
    const resp = form.getResponses();
    const sh = onbResponsesSheet_(onbSs_());
    log.push(['תשובות בטופס', String(resp.length)]);
    log.push(['שורות בגיליון התשובות', String(Math.max(0, sh.getLastRow() - 1)) + ' (לשונית "' + sh.getName() + '")']);
    const txt = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues().map(function (r) { return r.join(' | '); }).join('\n') : '';
    ['שחר לוי', 'רז ויטלשטיין', 'כנרת שור'].forEach(function (n) { log.push([n, txt.indexOf(n) >= 0 ? 'נמצא בגיליון ✓' : 'לא נמצא ✗']); });
    const c = coachCount_();
    log.push(['מונה המאמנים', c.error ? 'שגיאה: ' + c.error : c.total + ' (110 + ' + c.added + ': ' + c.names.join(', ') + ')']);
    try { const g = computeCoachGap_(true); log.push(['"3 שבועות בלי פגישה"', g.rows.length + ' מאמנים ברשימה (חושב עכשיו, עם גיליון התשובות החדש)']); }
    catch (e) { log.push(['"3 שבועות בלי פגישה"', 'שגיאה: ' + (e.message || e)]); }
    // בדיקת קליטה מקצה לקצה – מצב בדיקה ("בדיקת אפליקציה"): בלי Wix, בלי קבצים, בלי תפעול, בלי טלגרם/ווטסאפ/מייל
    const r = actionOnboard_({ test: true }, {});
    log.push(['קליטת בדיקה', 'נשלחה (' + r.rid + ') – הסטטוס יגיע לפעמון תוך דקה-שתיים']);
  } catch (e) { log.push(['שגיאה', String(e.message || e)]); }
  const sys = systemSs_();
  const t = sys.getSheetByName('קישור טופס הקליטה') || sys.insertSheet('קישור טופס הקליטה');
  t.clear();
  t.getRange(1, 1, log.length, 2).setNumberFormat('@').setValues(log.map(function (x) { return [String(x[0]), String(x[1])]; }));
}
