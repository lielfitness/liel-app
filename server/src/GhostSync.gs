/**
 * Ghosting אוטומטי: כל ליד שהסטטוס שלו Ghosting נמצא גם בלשונית "Ghosting" (בנוסף ל"לידים פעילים", לא במקום).
 * - נכנס: שינוי ל-Ghosting מהאפליקציה (כמו קודם), מעריכה ישירה בגיליון (הטריגר של האפליקציה), ובבדיקה שעתית.
 * - יוצא: לא נמחק (כדי לא לאבד שום דבר שנכתב בלשונית) – השורה מסומנת: אפור + קו חוצה, ובעמודה I "מצב":
 *   "יצא מ-Ghosting DD/MM → <סטטוס>". חוזר ל-Ghosting → הסימון מוסר מאותה שורה (בלי כפילות).
 * - "לידים פעילים" לא משתנה בכלל.
 */
const GHOST_STATE_HEADER_ = 'מצב';

/** עמודת "מצב" בלשונית Ghosting (שורה 2 = כותרות). נוצרת פעם אחת, אחרי העמודה האחרונה. */
function ghostStateCol_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(2, 1, 1, width).getDisplayValues()[0].map(normHeader_);
  let c = headers.indexOf(GHOST_STATE_HEADER_) + 1;
  if (c) return c;
  let used = headers.length;
  while (used > 0 && !headers[used - 1]) used--;
  c = used + 1;
  sh.getRange(2, c).setValue(GHOST_STATE_HEADER_).setFontWeight('bold');
  return c;
}

function ghostRowsIndex_(sh, stateCol) {
  const last = sh.getLastRow();
  const width = Math.max(sh.getLastColumn(), stateCol);
  const headers = sh.getRange(2, 1, 1, width).getDisplayValues()[0].map(normHeader_);
  const ip = headers.indexOf('טלפון'), ie = headers.indexOf('מייל');
  const rows = last >= 3 ? sh.getRange(3, 1, last - 2, width).getDisplayValues() : [];
  return rows.map(function (r, i) {
    return { row: i + 3, pk: ip >= 0 ? phoneKey_(r[ip]) : '', em: ie >= 0 ? String(r[ie]).trim().toLowerCase() : '', state: String(r[stateCol - 1] || '').trim(), width: width };
  });
}
function ghostFind_(idx, lead) {
  const pk = phoneKey_(lead.phone), em = String(lead.email || '').trim().toLowerCase();
  return idx.filter(function (g) { return (pk && g.pk === pk) || (em && em !== '-' && g.em === em); })[0] || null;
}
function ghostMark_(sh, g, stateCol, newStatus) {
  const text = 'יצא מ-Ghosting ' + Utilities.formatDate(new Date(), TZ_, 'dd/MM') + ' → ' + (newStatus || 'ללא סטטוס');
  sh.getRange(g.row, stateCol).setValue(text);
  sh.getRange(g.row, 1, 1, stateCol).setFontLine('line-through').setFontColor('#9e9e9e');
}
function ghostUnmark_(sh, g, stateCol) {
  sh.getRange(g.row, stateCol).clearContent();
  sh.getRange(g.row, 1, 1, stateCol).setFontLine('none').setFontColor('#000000');
}

/** מיישר ליד אחד לפי הסטטוס הנוכחי שלו. מחזיר מה נעשה. */
function ghostSyncLead_(cfg, lead) {
  if (!lead) return '';
  const sh = ghostSheet_(cfg);
  const stateCol = ghostStateCol_(sh);
  const idx = ghostRowsIndex_(sh, stateCol);
  const g = ghostFind_(idx, lead);
  const isGhost = canonicalStatus_(lead.status) === 'Ghosting';
  if (isGhost) {
    if (!g) { const r = copyToGhosting_(cfg, lead); return r && r.copied ? 'added' : ''; }
    if (g.state) { ghostUnmark_(sh, g, stateCol); invalidateGhost_(); return 'unmarked'; }
    return '';
  }
  if (g && !g.state) { ghostMark_(sh, g, stateCol, lead.status); invalidateGhost_(); return 'marked'; }
  return '';
}

/** בדיקה שעתית (מתוך הבדיקה של כל דקה): כל הלידים מול הלשונית */
function ghostReconcile_(force) {
  const props = PropertiesService.getScriptProperties();
  const lastRun = Number(props.getProperty('GHOST_SYNC_AT') || 0);
  if (!force && Date.now() - lastRun < 60 * 60000) return null;
  props.setProperty('GHOST_SYNC_AT', String(Date.now()));
  const cfg = getConfig_();
  const res = { added: 0, marked: 0, unmarked: 0 };
  withLock_(function () {
    CACHE_PATCH_ = 'skip';
    const leads = readLeads_(cfg).leads;
    const sh = ghostSheet_(cfg);
    const stateCol = ghostStateCol_(sh);
    let idx = ghostRowsIndex_(sh, stateCol);
    leads.forEach(function (l) {
      const isGhost = canonicalStatus_(l.status) === 'Ghosting';
      const g = ghostFind_(idx, l);
      if (isGhost && !g) { const r = copyToGhosting_(cfg, publicLead_(l)); if (r && r.copied) { res.added++; idx = ghostRowsIndex_(sh, stateCol); } }
      else if (isGhost && g && g.state) { ghostUnmark_(sh, g, stateCol); g.state = ''; res.unmarked++; }
      else if (!isGhost && g && !g.state) {
        // ליד עם אותו טלפון/מייל שנכנס שוב – מסמנים רק אם אין ליד אחר עם אותו טלפון שעדיין ב-Ghosting
        const otherGhost = leads.some(function (o) { return o !== l && canonicalStatus_(o.status) === 'Ghosting' && ghostFind_([g], o); });
        if (!otherGhost) { ghostMark_(sh, g, stateCol, l.status); g.state = 'x'; res.marked++; }
      }
    });
    invalidateGhost_();
  });
  writeJsonProp_('GHOST_SYNC_LAST', Object.assign({ at: Date.now() }, res));
  return res;
}

/** להרצה ידנית מהעורך: יישור מלא עכשיו */
function syncGhostingNow() { console.log(JSON.stringify(ghostReconcile_(true))); }
