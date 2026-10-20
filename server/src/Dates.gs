/**
 * פענוח תאריכים מבולגנים מהגיליון (קריאה בלבד – לא מתקנים נתונים ישנים).
 * צורות שקיימות בגיליון:
 *   16/06/2026 (יום/חודש), 6/23/2026 (חודש/יום, מ-Webflow), 21/6/26, 21.6, 5.1 (=5.10), "20:00 21/06"
 * כשיש כמה פירושים אפשריים בוחרים את הקרוב ביותר לתאריך ייחוס
 * (לעמודה A: הליד הקודם; לשאר העמודות: תאריך כניסת הליד).
 */

const TZ_ = 'Asia/Jerusalem';
const DAY_MS_ = 864e5;

function validDate_(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? dt : null;
}

/**
 * @param {*} value  ערך גולמי (getValues) – אם זה Date משתמשים בו ישר
 * @param {string} display  הטקסט המוצג (getDisplayValues)
 * @param {Date=} ref  תאריך ייחוס לפתרון דו-משמעות
 * @param {boolean=} after  האם התאריך אמור להיות אחרי ref (ניסיון שיחה/זום אחרי כניסת ליד)
 * @return {Date|null}
 */
function parseSheetDate_(value, display, ref, after) {
  if (value instanceof Date && !isNaN(value)) return value;
  const s = String(display == null ? value : display).trim();
  if (!s) return null;

  const m = s.match(/(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{4}|\d{2}))?(?!\d)/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  const refY = (ref || new Date()).getFullYear();
  let years = [refY, refY - 1, refY + 1];
  if (m[3]) years = [m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])];

  const cands = [];
  years.forEach(function (y) {
    // יום/חודש (ברירת המחדל הישראלית)
    cands.push(validDate_(y, b, a));
    // "5.1" שנשמר כמספר ואיבד את האפס של 10
    if (!m[3] && s.indexOf('.') >= 0 && b === 1) cands.push(validDate_(y, 10, a));
    // חודש/יום (אמריקאי) – רק כשיש שנה
    if (m[3] && a <= 12) cands.push(validDate_(y, a, b));
  });
  const list = cands.filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1 || !ref) return list[0];

  let best = null, bestCost = Infinity;
  list.forEach(function (c) {
    const diff = c.getTime() - ref.getTime();
    const cost = (after && diff < -2 * DAY_MS_) ? Math.abs(diff) * 4 : Math.abs(diff);
    if (cost < bestCost) { bestCost = cost; best = c; }
  });
  return best;
}

function fmtDate_(d) {
  return d ? Utilities.formatDate(d, TZ_, 'dd/MM/yyyy') : '';
}

function isoDate_(d) {
  return d ? Utilities.formatDate(d, TZ_, 'yyyy-MM-dd') : '';
}

function monthKey_(d) {
  return d ? Utilities.formatDate(d, TZ_, 'yyyy-MM') : '';
}

function todayMidnight_() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** "2026-10-21" → Date (חצות מקומי) */
function parseIso_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? validDate_(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}
