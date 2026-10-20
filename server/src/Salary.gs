/**
 * "החודש שלי" – שכר שי לפי הכלל של ליאל:
 *  - 15 ₪ לכל ליד שנכנס בחודש (לפי עמודה A).
 *  - פגישה נספרת לבונוס רק כשיש תאריך זום (R) ותוצאת זום (P) = נסגר / לא נסגר / ממתין.
 *    "לא הגיע" = בלי בונוס. P ריק (עוד לא התקיימה / בוטלה) = לא נספרת.
 *  - הבונוס שייך לחודש של תאריך הזום. מדרגות לפי סדר הפגישות בחודש: 1–5 = 80, 6–10 = 100, 11+ = 120.
 *    באותו תאריך: קודם לפי המדרגה שכבר רשומה ב-S (כדי לא לשנות נתונים קיימים), ואז לפי סדר השורות.
 */

const BASE_PER_LEAD_ = 15;
const COUNTED_RESULTS_ = ['נסגר', 'לא נסגר', 'ממתין'];
const NO_SHOW_ = 'לא הגיע';

function tierAmount_(n) {
  return n <= 5 ? 80 : (n <= 10 ? 100 : 120);
}

function rewardFromS_(s) {
  const t = String(s || '').trim();
  if (!t) return { kind: 'empty', amount: null };
  if (/^לא/.test(t)) return { kind: 'no', amount: 0 };
  const m = t.match(/(\d+)/);
  return { kind: 'yes', amount: m ? Number(m[1]) : null };
}

/** הפגישות שנספרות בחודש, ממוינות ועם מדרגה. */
function monthMeetings_(leads, month) {
  const inMonth = leads.filter(function (l) { return l.zoomDate && l.zoomDate.slice(0, 7) === month; });
  const counted = inMonth.filter(function (l) { return COUNTED_RESULTS_.indexOf(String(l.zoomResult).trim()) >= 0; })
    .sort(function (a, b) {
      if (a.zoomDate !== b.zoomDate) return a.zoomDate < b.zoomDate ? -1 : 1;
      const sa = rewardFromS_(a.reward).amount || 999, sb = rewardFromS_(b.reward).amount || 999;
      if (sa !== sb) return sa - sb;
      return a.row - b.row;
    });
  return {
    counted: counted.map(function (l, i) {
      const n = i + 1;
      return { lead: l, n: n, tier: n <= 5 ? 1 : (n <= 10 ? 2 : 3), amount: tierAmount_(n) };
    }),
    noShow: inMonth.filter(function (l) { return String(l.zoomResult).trim() === NO_SHOW_; }),
    pending: inMonth.filter(function (l) {
      const p = String(l.zoomResult).trim();
      return COUNTED_RESULTS_.indexOf(p) < 0 && p !== NO_SHOW_;
    }),
  };
}

/** חודש נעול: הסכומים לפי מה שרשום ב-S (מה ששולם), לא לפי חישוב מחדש. */
function lockedMonthMeetings_(leads, month) {
  const inMonth = leads.filter(function (l) { return l.zoomDate && l.zoomDate.slice(0, 7) === month; });
  const yes = inMonth.filter(function (l) { return rewardFromS_(l.reward).kind === 'yes'; })
    .sort(function (a, b) {
      if (a.zoomDate !== b.zoomDate) return a.zoomDate < b.zoomDate ? -1 : 1;
      return (rewardFromS_(a.reward).amount || 0) - (rewardFromS_(b.reward).amount || 0) || a.row - b.row;
    });
  return {
    counted: yes.map(function (l, i) {
      const amt = rewardFromS_(l.reward).amount || 0;
      return { lead: l, n: i + 1, tier: amt >= 120 ? 3 : (amt >= 100 ? 2 : 1), amount: amt };
    }),
    noShow: inMonth.filter(function (l) { return rewardFromS_(l.reward).kind === 'no'; }),
    pending: inMonth.filter(function (l) { return rewardFromS_(l.reward).kind === 'empty'; }),
  };
}

function actionMonth_(req, ctx) {
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : monthKey_(now);
  const leads = readLeads_(ctx.cfg).leads;
  const locked = isLockedMonth_(month);

  const entered = leads.filter(function (l) { return l.entry && l.entry.slice(0, 7) === month; });
  const mm = locked ? lockedMonthMeetings_(leads, month) : monthMeetings_(leads, month);
  // בחודש נעול: שינויים ב-R/P אחרי הנעילה שלא השתקפו ב-S
  const lockedDiffs = locked ? desiredRewards_(leads, month)
    .filter(function (d) { return String(d.lead.reward || '').trim() !== d.value; })
    .map(function (d) { return { id: d.lead.id, name: d.lead.name, date: d.lead.zoomDate, sheet: d.lead.reward, rule: d.value }; }) : [];

  const list = mm.counted.map(function (m) {
    const s = rewardFromS_(m.lead.reward);
    return {
      n: m.n, row: m.lead.row, id: m.lead.id, name: m.lead.name, date: m.lead.zoomDate,
      tier: m.tier, amount: m.amount, sheetReward: m.lead.reward,
      mismatch: s.amount == null || s.amount !== m.amount,
      zoomResult: m.lead.zoomResult,
    };
  });
  const brief = function (l) { return { id: l.id, name: l.name, date: l.zoomDate, zoomResult: l.zoomResult, sheetReward: l.reward }; };

  const bonus = list.reduce(function (s, m) { return s + m.amount; }, 0);
  const count = list.length;
  const nextTierAt = count < 6 ? 6 : (count < 11 ? 11 : null);

  return {
    month: month,
    locked: locked,
    lockedDiffs: lockedDiffs,
    leadsCount: entered.length,
    basePerLead: BASE_PER_LEAD_,
    baseTotal: entered.length * BASE_PER_LEAD_,
    meetings: list,
    noShow: mm.noShow.map(brief),
    pending: mm.pending.map(brief).sort(function (a, b) { return a.date < b.date ? -1 : 1; }),
    bonusTotal: bonus,
    total: entered.length * BASE_PER_LEAD_ + bonus,
    currentTier: count === 0 ? 0 : (count <= 5 ? 1 : (count <= 10 ? 2 : 3)),
    toNextTier: nextTierAt ? nextTierAt - count : 0,
    nextTierAmount: nextTierAt ? tierAmount_(nextTierAt) : null,
  };
}

// ---------- כתיבה ל-S (תגמול מגיע?) ----------
// חלה רק על החודש הנוכחי והקודם (וחודשים עתידיים). חודשים ישנים יותר נעולים – S שלהם לא משתנה.

function prevMonthKey_() {
  const n = new Date();
  return monthKey_(new Date(n.getFullYear(), n.getMonth() - 1, 1));
}

function isLockedMonth_(month) {
  return !!month && month < prevMonthKey_();
}

function rewardText_(amount) {
  return 'כן — ' + amount + '₪';
}

/** הערך הנכון ל-S לכל ליד שיש לו זום בחודש. */
function desiredRewards_(leads, month) {
  const mm = monthMeetings_(leads, month);
  const out = [];
  mm.counted.forEach(function (m) { out.push({ lead: m.lead, value: rewardText_(m.amount) }); });
  mm.noShow.forEach(function (l) { out.push({ lead: l, value: 'לא' }); });
  mm.pending.forEach(function (l) { out.push({ lead: l, value: '' }); });
  return out;
}

/**
 * מחשב מחדש את S לחודשים הפתוחים מתוך months. dry=true → רק מחזיר מה היה משתנה.
 * @return {{changes: Array, locked: Array<string>}}
 */
function syncRewards_(sh, leads, months, dry) {
  const uniq = months.filter(function (m, i) { return m && months.indexOf(m) === i; });
  const locked = uniq.filter(isLockedMonth_);
  const changes = [];
  uniq.filter(function (m) { return !isLockedMonth_(m); }).forEach(function (m) {
    desiredRewards_(leads, m).forEach(function (d) {
      const cur = String(d.lead.reward || '').trim();
      if (cur === d.value) return;
      changes.push({ row: d.lead.row, name: d.lead.name, month: m, from: cur, to: d.value });
      if (!dry) sh.getRange(d.lead.row, COL_.reward).setValue(d.value);
    });
  });
  return { changes: changes, locked: locked };
}

function openMonths_() {
  return [prevMonthKey_(), monthKey_(new Date())];
}

function lockedWarning_(locked) {
  return locked.length
    ? 'החודש ' + locked.join(', ') + ' נעול (כבר שולם) – התגמול ב-S לא שונה. אם צריך תיקון, עדכנו ידנית.'
    : '';
}

/** הרצה ידנית מהעורך: מה היה משתנה ב-S (בלי לכתוב). */
function syncRewardsDryRun() {
  const r = readLeads_(getConfig_());
  const res = syncRewards_(r.sh, r.leads, openMonths_(), true);
  console.log('חודשים: ' + openMonths_().join(', ') + ' | תאים שהיו משתנים ב-S: ' + res.changes.length +
    (res.changes.length ? '\n' + res.changes.map(function (c) { return 'שורה ' + c.row + ' ' + c.name + ': "' + c.from + '" → "' + c.to + '"'; }).join('\n') : ''));
}

/** הרצה ידנית מהעורך: כותב את S לחודשים הפתוחים. */
function syncRewardsNow() {
  const cfg = getConfig_();
  withLock_(function () {
    const r = readLeads_(cfg);
    const res = syncRewards_(r.sh, r.leads, openMonths_(), false);
    console.log('חודשים: ' + openMonths_().join(', ') + ' | תאים שנכתבו ב-S: ' + res.changes.length);
  });
}
