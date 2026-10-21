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

function undoIndexKey_(email) { return 'UI:' + email; }
function undoEntryKey_(email, id) { return 'U:' + email + ':' + id; }

function undoIndex_(email) {
  return readJsonProp_(undoIndexKey_(email), []);
}

function undoCount_(email) {
  return email ? undoIndex_(email).length : 0;
}

function describeFields_(fields) {
  const names = Object.keys(fields).map(function (k) { return FIELD_LABELS_[k] || k; });
  return names.length <= 2 ? names.join(' ו') : names.slice(0, -1).join(', ') + ' ו' + names[names.length - 1];
}

/** שומר פעולה לביטול (בלי "עודכן לאחרונה"). */
function recordUndo_(email, loc, desc, extra) {
  if (!email || !loc.undo) return;
  loc.undoCount = null;
  const changes = Object.keys(loc.undo).map(function (c) { return loc.undo[c]; })
    .filter(function (c) { return c.ad != null && c.bd !== c.ad; });
  if (!changes.length && !(extra && extra.ghost)) return;
  const entry = {
    id: Utilities.getUuid().slice(0, 8), ts: Date.now(),
    leadId: loc.lead.id, row: loc.lead.row, name: loc.lead.name, desc: desc,
    changes: changes, zoomMonths: extra && extra.zoomMonths || null, ghost: extra && extra.ghost || null,
  };
  const json = JSON.stringify(entry);
  if (json.length > 8500) return;   // שינוי ארוך במיוחד – לא נשמר לביטול
  const props = PropertiesService.getScriptProperties();
  const idx = undoIndex_(email);
  idx.push(entry.id);
  while (idx.length > UNDO_MAX_) props.deleteProperty(undoEntryKey_(email, idx.shift()));
  const upd = {};
  upd[undoEntryKey_(email, entry.id)] = json;
  upd[undoIndexKey_(email)] = JSON.stringify(idx);
  props.setProperties(upd);   // כתיבה אחת
  loc.undoCount = idx.length;
}

let UNDO_LEFT_ = null;
function popUndo_(email) {
  const idx = undoIndex_(email);
  const id = idx.pop();
  UNDO_LEFT_ = idx.length;
  if (!id) return null;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(undoEntryKey_(email, id));
  props.deleteProperty(undoEntryKey_(email, id));
  writeJsonProp_(undoIndexKey_(email), idx);
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

function deserializeCell_(v) {
  return v && typeof v === 'object' && v.d ? new Date(v.d) : v;
}

function actionUndoCount_(req, ctx) {
  return { undoCount: undoCount_(ctx.email) };
}

function actionUndo_(req, ctx) {
  let out = null, loc = null;
  phase_('start');
  withLock_(function () {
    const e = popUndo_(ctx.email);
    if (!e) { out = { done: false, message: 'אין מה לבטל' }; return; }

    phase_('pop');
    try { loc = locateForWrite_(ctx.cfg, e.row, e.leadId); } catch (err) {
      out = { done: false, message: 'אי אפשר לבטל: הליד ' + e.name + ' לא נמצא בגיליון (אולי נמחק).' };
      return;
    }
    phase_(loc.fast ? 'read row (api)' : 'read row');
    const row = loc.lead.row;
    const width = Math.max(LAST_BASE_COL_, loc.ex.updated, loc.ex.shaiNotes);
    const cur = loc.lead._raw ? loc.lead._raw.d : loc.sh.getRange(row, 1, 1, width).getDisplayValues()[0];

    // מישהו שינה את אותו שדה אחרי הפעולה? לא דורסים.
    const conflict = e.changes.filter(function (c) { return String(cur[c.col - 1] || '').trim() !== String(c.ad || '').trim(); });
    if (conflict.length) {
      loc = null;
      out = { done: false, message: 'אי אפשר לבטל: ' + e.desc + ' של ' + e.name + ' שונה מאז (על ידי מישהו אחר או ישירות בגיליון). לא שיניתי כלום.' };
      return;
    }

    let ssh = null;   // לפעולות ישנות שנשמרו בפורמט הקודם
    e.changes.forEach(function (c) {
      const isNew = ('uv' in c) || ('nf' in c);
      if (loc.fast && isNew) {
        loc.pending[c.col] = fastRestoreCell_(c.uv, c.nf);
      } else if (isNew) {
        // מסלול רגיל עם רשומה חדשה: משחזרים לפי התצוגה הקודמת
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

    let extra = '';
    if (e.ghost) extra = removeGhostRow_(ctx.cfg, e.ghost);

    let warning = '';
    if (!e.zoomMonths && !e.ghost) {
      loc.out = leadAfterWrite_(ctx.cfg, loc);
      if (loc.out) CACHE_PATCH_ = loc.out;
    }
    if (e.zoomMonths) {
      SpreadsheetApp.flush();
      const r2 = readLeads_(ctx.cfg);
      const res = syncRewards_(r2.sh, r2.leads, e.zoomMonths, false);
      warning = lockedWarning_(res.locked);
      loc.lead._raw = null;
    }

    let message = 'בוטל: ' + e.desc + ' של ' + e.name;
    if (e.changes.length === 1 && FIELD_LABELS_[keyOfCol_(e.changes[0].col)]) {
      message += ' חזר ל"' + (e.changes[0].bd || 'ריק') + '"';
    }
    if (extra) message += ' · ' + extra;
    out = { done: true, message: message, warning: warning };
  });
  if (out.done && loc) out.lead = loc.out || leadAfterWrite_(ctx.cfg, loc);
  out.undoCount = UNDO_LEFT_ != null ? UNDO_LEFT_ : undoCount_(ctx.email);
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
