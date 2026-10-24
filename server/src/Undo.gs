/**
 * "בטל" (↶): כל משתמש מבטל את הפעולות שלו, מהאחרונה אחורה (עד 15).
 * כל פעולה שמורה ב-Script Properties: אינדקס לכל משתמש + פעולה לכל מפתח (מגבלה של 9KB לערך).
 * לפני ביטול בודקים שהתאים עדיין מכילים בדיוק את מה שנכתב; אם מישהו שינה מאז – לא דורסים.
 */

const UNDO_MAX_ = 15;

const FIELD_LABELS_ = {
  status: 'סטטוס', summary: 'עיקרי שיחה', shaiNotes: 'הערות של שי', notes: 'פירוט תוצאת זום',
  zoomDate: 'תאריך זום', zoomResult: 'תוצאת זום', callResult: 'תוצאת שיחה',
};

// שתי מחסניות לכל משתמש: U = לביטול (↶), R = לביצוע שוב (↷).
// כל מחסנית = ערך אחד ב-Script Properties (מערך של פעולות) – קריאה אחת וכתיבה אחת לכל פעולה (מהיר).
// הפורמט הישן (אינדקס + ערך לכל פעולה) מומר אוטומטית בקריאה הראשונה.
function stackIndexKey_(st, email) { return st + 'I:' + email; }        // פורמט ישן
function stackEntryKey_(st, email, id) { return st + ':' + email + ':' + id; }
function stackKey_(st, email) { return 'US:' + st + ':' + email; }
const STACK_N_ = {};   // כמה פעולות יש בכל מחסנית (מתעדכן בכל קריאה/כתיבה בבקשה הזו)

function loadStack_(st, email) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(stackKey_(st, email));
  let list = null;
  if (raw) { try { list = JSON.parse(raw); } catch (e) { list = []; } }
  else {
    // המרה מהפורמט הישן (פעם אחת)
    const oldIdx = props.getProperty(stackIndexKey_(st, email));
    list = [];
    if (oldIdx) {
      let ids = [];
      try { ids = JSON.parse(oldIdx); } catch (e) { ids = []; }
      ids.forEach(function (id) {
        const r = props.getProperty(stackEntryKey_(st, email, id));
        if (r) { try { list.push(JSON.parse(r)); } catch (e) { /* */ } }
        props.deleteProperty(stackEntryKey_(st, email, id));
      });
      props.deleteProperty(stackIndexKey_(st, email));
      saveStack_(st, email, list);
    }
  }
  STACK_N_[st] = list.length;
  return list;
}
function saveStack_(st, email, list) {
  let l = list.slice(-UNDO_MAX_);
  let json = JSON.stringify(l);
  while (json.length > 8800 && l.length) { l = l.slice(1); json = JSON.stringify(l); }   // מגבלת 9KB לערך
  const props = PropertiesService.getScriptProperties();
  if (l.length) props.setProperty(stackKey_(st, email), json); else props.deleteProperty(stackKey_(st, email));
  STACK_N_[st] = l.length;
  return l.length;
}
function undoCount_(email) { if (!email) return 0; return STACK_N_.U != null ? STACK_N_.U : loadStack_('U', email).length; }
function redoCount_(email) { if (!email) return 0; return STACK_N_.R != null ? STACK_N_.R : loadStack_('R', email).length; }

function describeFields_(fields) {
  const names = Object.keys(fields).map(function (k) { return FIELD_LABELS_[k] || k; });
  return names.length <= 2 ? names.join(' ו') : names.slice(0, -1).join(', ') + ' ו' + names[names.length - 1];
}

/** פעולה חדשה של המשתמש: נשמרת לביטול, ומחסנית "בצע שוב" מתרוקנת (כמו בכל אפליקציה). */
function recordUndo_(email, loc, desc, extra) {
  if (!email || !loc.undo) return;
  loc.undoCount = null;
  const changes = Object.keys(loc.undo).map(function (c) { return loc.undo[c]; })
    .filter(function (c) { return c.ad != null && c.bd !== c.ad; });
  if (!changes.length && !(extra && extra.ghost)) return;
  const entry = {
    leadId: loc.lead.id, row: loc.lead.row, name: loc.lead.name, desc: desc,
    changes: changes, zoomMonths: extra && extra.zoomMonths || null, ghost: extra && extra.ghost || null,
  };
  pushUndoEntry_(email, entry, loc);
}

function pushUndoEntry_(email, entry, loc) {
  pushStack_('U', email, entry, loc);
  clearStack_('R', email);
}

function pushStack_(st, email, entry, loc) {
  entry.id = Utilities.getUuid().slice(0, 8);
  entry.ts = Date.now();
  if (JSON.stringify(entry).length > 8500) return STACK_N_[st] || 0;   // שינוי ארוך במיוחד – לא נשמר
  const list = loadStack_(st, email);
  list.push(entry);
  const n = saveStack_(st, email, list);
  if (loc && st === 'U') loc.undoCount = n;
  return n;
}

function clearStack_(st, email) {
  PropertiesService.getScriptProperties().deleteProperty(stackKey_(st, email));
  STACK_N_[st] = 0;
}

function popStack_(st, email) {
  const list = loadStack_(st, email);
  const e = list.pop();
  if (!e) return null;
  saveStack_(st, email, list);
  return e;
}

function deserializeCell_(v) {
  return v && typeof v === 'object' && v.d ? new Date(v.d) : v;
}

function actionUndoCount_(req, ctx) {
  return { undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) };
}

function actionUndo_(req, ctx) { return undoRedo_(req, ctx, 'U', 'R', 'בוטל'); }
function actionRedo_(req, ctx) { return undoRedo_(req, ctx, 'R', 'U', 'בוצע שוב'); }

/** מוציא פעולה ממחסנית אחת, מחזיר את הגיליון למצב שבה, ושומר את ההפך במחסנית השנייה. */
function undoRedo_(req, ctx, from, to, verb) {
  let out = null, loc = null;
  phase_('start');
  let dup = null;
  withLock_(function () {
    dup = opSeen_(req); if (dup) { CACHE_PATCH_ = 'skip'; return; }   // ↶/↷ שכבר בוצע – לא מבצעים שוב
    const e = popStack_(from, ctx.email);
    opMark_(req);
    if (!e) { out = { done: false, message: verb === 'בוטל' ? 'אין מה לבטל' : 'אין מה לבצע שוב' }; return; }

    if (e.kind === 'delete') {          // ↶ מחיקת ליד → מחזיר את הליד
      out = restoreDeleted_(ctx, e);
      if (out.done) pushStack_(to, ctx.email, { kind: 'redelete', leadId: out.leadId, row: out.restoredRow, name: e.name, phone: e.phone, desc: 'מחיקת ליד' });
      if (out.done && verb !== 'בוטל') out.message = out.message.replace(/^בוטל:/, verb + ':');
      return;
    }
    if (e.kind === 'redelete') {        // ↷ מחיקת ליד שבוטלה → מוחק שוב
      try {
        const d = deleteLeadCore_(ctx, e.row, e.leadId, e.name, e.phone, true);
        pushStack_(to, ctx.email, d.entry);
        out = { done: true, message: verb + ': מחיקת ' + e.name, deletedId: e.leadId };
      } catch (err) {
        out = { done: false, message: 'אי אפשר ל' + (verb === 'בוטל' ? 'בטל' : 'בצע שוב') + ': ' + (err.message || err) };
      }
      return;
    }

    phase_('pop');
    try { loc = locateForWrite_(ctx.cfg, e.row, e.leadId); } catch (err) {
      out = { done: false, message: 'אי אפשר ל' + (verb === 'בוטל' ? 'בטל' : 'בצע שוב') + ': הליד ' + e.name + ' לא נמצא בגיליון (אולי נמחק).' };
      return;
    }
    phase_(loc.fast ? 'read row (api)' : 'read row');
    const row = loc.lead.row;
    const width = Math.max(LAST_BASE_COL_, loc.ex.updated, loc.ex.shaiNotes);
    const cur = loc.lead._raw ? loc.lead._raw.d : loc.sh.getRange(row, 1, 1, width).getDisplayValues()[0];

    // מישהו שינה את אותו שדה בינתיים? לא דורסים.
    const conflict = e.changes.filter(function (c) { return String(cur[c.col - 1] || '').trim() !== String(c.ad || '').trim(); });
    if (conflict.length) {
      loc = null;
      out = { done: false, message: 'אי אפשר ל' + (verb === 'בוטל' ? 'בטל' : 'בצע שוב') + ': ' + e.desc + ' של ' + e.name +
        ' שונה מאז (על ידי מישהו אחר או ישירות בגיליון). לא שיניתי כלום.' };
      return;
    }

    // ההפך (למחסנית השנייה): המצב המדויק של התאים לפני השינוי הזה
    const inverse = { leadId: loc.lead.id, row: row, name: e.name, desc: e.desc, zoomMonths: e.zoomMonths || null, changes: [] };
    const snapNow = loc.fast ? null : rowSnapshot_(loc);
    e.changes.forEach(function (c) {
      if (loc.fast) {
        const fc = loc.cells[c.col - 1] || {};
        inverse.changes.push({ col: c.col, uv: fc.userEnteredValue || null, nf: (fc.userEnteredFormat && fc.userEnteredFormat.numberFormat) || null, bd: c.ad, ad: c.bd });
      } else {
        inverse.changes.push({ col: c.col, bv: serializeCell_(snapNow.v[c.col - 1]), bf: snapNow.f[c.col - 1] || '', bd: c.ad, ad: c.bd });
      }
    });

    let ssh = null;
    e.changes.forEach(function (c) {
      const isNew = ('uv' in c) || ('nf' in c);
      if (loc.fast && isNew) {
        loc.pending[c.col] = fastRestoreCell_(c.uv, c.nf);
      } else if (isNew) {
        const r = loc.sh.getRange(row, c.col);
        if (!c.bd) r.clearContent(); else r.setValue(c.bd);
      } else {
        ssh = ssh || loc.sh || leadsSheet_(ctx.cfg);
        const r = ssh.getRange(row, c.col);
        r.setNumberFormat(c.bf || 'General');
        const v = deserializeCell_(c.bv);
        if (v === '' || v == null) r.clearContent(); else r.setValue(v);
      }
      if (loc.lead._raw) { loc.lead._raw.v[c.col - 1] = c.bd; loc.lead._raw.d[c.col - 1] = c.bd; }
    });
    if (e.changes.length) touch_(null, row, loc.upCol, loc);
    commitFast_(loc);
    phase_('write');

    // גוסטינג: ↶ מסיר את השורה שנוספה; ↷ מעתיק שוב
    let extra = '';
    if (e.ghost) { extra = removeGhostRow_(ctx.cfg, e.ghost); inverse.ghostRecopy = true; }
    if (e.ghostRecopy) {
      SpreadsheetApp.flush();
      const after = leadAfterWrite_(ctx.cfg, loc);
      const g = after ? copyToGhosting_(ctx.cfg, after) : null;
      if (g && g.copied) { inverse.ghost = g; extra = 'הועתק שוב לגוסטינג'; }
    }

    let warning = '';
    loc.out = leadAfterWrite_(ctx.cfg, loc);
    if (!e.ghost && !e.ghostRecopy && loc.out) CACHE_PATCH_ = loc.out;
    // תגמול (S): מחושב ברקע תוך דקה (לא בתוך הבקשה)
    if (e.zoomMonths) { queueRewardSync_(e.zoomMonths, null); warning = lockedMonthsWarning_(e.zoomMonths); }
    pushStack_(to, ctx.email, inverse);

    let message = verb + ': ' + e.desc + ' של ' + e.name;
    if (e.changes.length === 1 && FIELD_LABELS_[keyOfCol_(e.changes[0].col)]) {
      message += ' חזר ל"' + (e.changes[0].bd || 'ריק') + '"';
    }
    if (extra) message += ' · ' + extra;
    out = { done: true, message: message, warning: warning };
  });
  if (dup) return opDupOut_(dup, ctx);
  if (out.done && loc) out.lead = loc.out || leadAfterWrite_(ctx.cfg, loc);
  if (out.done && out.restoredRow) out.lead = rereadLead_(ctx.cfg, out.leadId, out.restoredRow);
  opMark_(req, { done: out.done, message: out.message, lead: out.lead || null });   // התוצאה האמיתית – לשליחה חוזרת
  out.undoCount = undoCount_(ctx.email);   // מהזיכרון של הבקשה – בלי קריאה נוספת
  out.redoCount = redoCount_(ctx.email);
  phase_('build');
  if (req.debug) out.phases = PHASES_;
  return out;
}

function keyOfCol_(col) {
  const keys = Object.keys(EDITABLE_);
  for (let i = 0; i < keys.length; i++) if (EDITABLE_[keys[i]] === col) return keys[i];
  return '';
}

/** מסיר את השורה שנוספה לגוסטינג – רק אם היא עדיין שם ומתאימה לליד. */
function removeGhostRow_(cfg, g) {
  const sh = ghostSheet_(cfg);
  const width = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(2, 1, 1, width).getDisplayValues()[0].map(normHeader_);
  const pc = headers.indexOf('טלפון'), nc = headers.indexOf('שם מלא');
  const last = sh.getLastRow();
  if (last < 3 || pc < 0) return 'לא מצאתי את השורה בגוסטינג – כדאי לבדוק ידנית';
  const data = sh.getRange(3, 1, last - 2, width).getDisplayValues();
  const matches = function (r) {
    return phoneKey_(r[pc]) === phoneKey_(g.phone) && (nc < 0 || String(r[nc]).trim() === String(g.name || '').trim());
  };
  let target = 0;
  if (g.row >= 3 && g.row <= last && matches(data[g.row - 3])) target = g.row;
  else {
    const hits = [];
    data.forEach(function (r, i) { if (matches(r)) hits.push(i + 3); });
    if (hits.length === 1) target = hits[0];
  }
  if (!target) return 'לא מצאתי את השורה בגוסטינג – כדאי לבדוק ידנית';
  sh.deleteRow(target);
  invalidateGhost_();
  return 'הוסר מהגוסטינג';
}
