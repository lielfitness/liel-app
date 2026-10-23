/**
 * מחיקת ליד (ליאל בלבד).
 * לפני המחיקה השורה כולה (ערכים + פורמטים, כל העמודות) מועתקת ללשונית המוסתרת "לידים שנמחקו (מערכת)",
 * עם תאריך, מי מחק ומצב. רק אחרי שווידאנו שההעתקה הצליחה – השורה נמחקת מ"לידים פעילים".
 * זיהוי לפי מזהה + שם + טלפון (לא לפי מספר שורה). לשונית Ghosting לא נוגעים.
 * ↶ מחזיר את הליד לסוף הגיליון.
 */

const DELETED_TAB_ = 'לידים שנמחקו (מערכת)';
const DELETED_META_ = 3;   // A נמחק בתאריך | B נמחק על ידי | C מצב (נמחק / שוחזר) | מ-D: השורה המקורית

function deletedSheet_(cfg) {
  const sh = SpreadsheetApp.openById(cfg.leadsSheetId).getSheetByName(DELETED_TAB_);
  if (!sh) throw apiError_('CONFIG', 'לא נמצאה הלשונית "' + DELETED_TAB_ + '"');
  return sh;
}

function userName_(ctx) {
  return (ctx.cfg.names && ctx.cfg.names[ctx.email]) || USER_NAMES_BY_ROLE_[ctx.realRole] || ctx.email;
}

function actionDeleteLead_(req, ctx) {
  let out = null;
  withLock_(function () {
    const d = deleteLeadCore_(ctx, req.row, req.id, req.name, req.phone, req.force);
    if (d.needsConfirm) { out = d; return; }
    pushUndoEntry_(ctx.email, d.entry);
    out = { deleted: true, undoCount: undoCount_(ctx.email), redoCount: redoCount_(ctx.email) };
  });
  return out;
}

/** הליבה של המחיקה (בתוך נעילה): העתקה לארכיון, וידוא, מחיקה. מחזיר רשומה לביטול. */
function deleteLeadCore_(ctx, row, id, name, phone, force) {
  const loc = locateLead_(ctx.cfg, row, id);
  const lead = loc.lead;
  if (normName_(lead.name) !== normName_(name) || phoneKey_(lead.phone) !== phoneKey_(phone)) {
    throw apiError_('STALE', 'השם או הטלפון בשורה לא תואמים – רענן את הרשימה ונסה שוב. לא מחקתי כלום.');
  }
  const fz = futureZoomByLead_()[lead.id];
  if (fz && !force) return { needsConfirm: true, zoomStart: fz.start };

  const sh = loc.sh;
  const width = sh.getLastColumn();
  const arch = deletedSheet_(ctx.cfg);
  const target = Math.max(arch.getLastRow() + 1, 2);
  if (arch.getMaxColumns() < width + DELETED_META_) arch.insertColumnsAfter(arch.getMaxColumns(), width + DELETED_META_ - arch.getMaxColumns());
  if (arch.getMaxRows() < target) arch.insertRowsAfter(arch.getMaxRows(), 50);

  // 1) העתקה מלאה (ערכים + פורמטים) לארכיון
  sh.getRange(lead.row, 1, 1, width).copyTo(arch.getRange(target, DELETED_META_ + 1, 1, width));
  arch.getRange(target, 1, 1, DELETED_META_).setNumberFormat('@').setValues([[nowStamp_(), userName_(ctx), 'נמחק']]);
  SpreadsheetApp.flush();
  // 2) וידוא שההעתקה הצליחה – ורק אז מחיקה
  const chk = arch.getRange(target, DELETED_META_ + 1, 1, COL_.phone).getDisplayValues()[0];
  if (normName_(chk[COL_.name - 1]) !== normName_(lead.name) || phoneKey_(chk[COL_.phone - 1]) !== phoneKey_(lead.phone)) {
    throw apiError_('ERROR', 'ההעתקה ללשונית "' + DELETED_TAB_ + '" לא הצליחה – לא מחקתי כלום');
  }
  sh.deleteRow(lead.row);
  return { entry: { kind: 'delete', leadId: lead.id, row: lead.row, name: lead.name, phone: lead.phone, archRow: target, width: width, desc: 'מחיקת ליד', changes: [] } };
}

/** ↶ למחיקת ליד: מחזיר את השורה מהארכיון לסוף "לידים פעילים". */
function restoreDeleted_(ctx, e) {
  const arch = deletedSheet_(ctx.cfg);
  if (e.archRow > arch.getLastRow()) return { done: false, message: 'אי אפשר לבטל: השורה של ' + e.name + ' לא נמצאה בלשונית "' + DELETED_TAB_ + '".' };
  const meta = arch.getRange(e.archRow, 1, 1, DELETED_META_ + COL_.phone).getDisplayValues()[0];
  if (meta[2] !== 'נמחק' || normName_(meta[DELETED_META_ + COL_.name - 1]) !== normName_(e.name) ||
      phoneKey_(meta[DELETED_META_ + COL_.phone - 1]) !== phoneKey_(e.phone)) {
    return { done: false, message: 'אי אפשר לבטל: השורה של ' + e.name + ' בלשונית "' + DELETED_TAB_ + '" שונתה או כבר שוחזרה.' };
  }
  const sh = leadsSheet_(ctx.cfg);
  const target = sh.getLastRow() + 1;
  if (sh.getMaxRows() < target) sh.insertRowsAfter(sh.getMaxRows(), 10);
  arch.getRange(e.archRow, DELETED_META_ + 1, 1, e.width).copyTo(sh.getRange(target, 1, 1, e.width));
  arch.getRange(e.archRow, 3).setValue('שוחזר');
  SpreadsheetApp.flush();
  return { done: true, message: 'בוטל: מחיקת ' + e.name + ' – הליד הוחזר לסוף הגיליון (שורה ' + target + ')', restoredRow: target, leadId: e.leadId };
}
