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

function actionMonth_(req, ctx) {
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : monthKey_(now);
  const leads = readLeads_(ctx.cfg).leads;

  const entered = leads.filter(function (l) { return l.entry && l.entry.slice(0, 7) === month; });
  const mm = monthMeetings_(leads, month);

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
