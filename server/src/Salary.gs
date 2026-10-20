/**
 * "החודש שלי" – שכר שי לפי הכלל של ליאל:
 *  - 15 ₪ לכל ליד שנכנס בחודש (לפי עמודה A).
 *  - בונוס פגישות לפי תאריך הזום (R). S = "לא" → לא נספר.
 *    מדרגות לפי סדר הפגישות בחודש: 1–5 = 80, 6–10 = 100, 11+ = 120.
 */

const BASE_PER_LEAD_ = 15;

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

function actionMonth_(req, ctx) {
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : monthKey_(now);
  const leads = readLeads_(ctx.cfg).leads;
  const today = todayMidnight_();

  const entered = leads.filter(function (l) { return l.entry && l.entry.slice(0, 7) === month; });

  const meetings = leads
    .filter(function (l) { return l.zoomDate && l.zoomDate.slice(0, 7) === month; })
    .map(function (l) { return { lead: l, s: rewardFromS_(l.reward) }; });
  const excluded = meetings.filter(function (m) { return m.s.kind === 'no'; });
  const counted = meetings.filter(function (m) { return m.s.kind !== 'no'; })
    .sort(function (a, b) { return a.lead.zoomDate < b.lead.zoomDate ? -1 : (a.lead.zoomDate > b.lead.zoomDate ? 1 : a.lead.row - b.lead.row); });

  const list = counted.map(function (m, i) {
    const n = i + 1, amount = tierAmount_(n);
    return {
      n: n, row: m.lead.row, id: m.lead.id, name: m.lead.name, date: m.lead.zoomDate,
      tier: n <= 5 ? 1 : (n <= 10 ? 2 : 3), amount: amount,
      sheetReward: m.lead.reward,
      mismatch: m.s.amount != null && m.s.amount !== amount,
      happened: parseIso_(m.lead.zoomDate) <= today,
      zoomResult: m.lead.zoomResult,
    };
  });

  const bonus = list.reduce(function (s, m) { return s + m.amount; }, 0);
  const count = list.length;
  const nextTierAt = count < 6 ? 6 : (count < 11 ? 11 : null);

  return {
    month: month,
    leadsCount: entered.length,
    basePerLead: BASE_PER_LEAD_,
    baseTotal: entered.length * BASE_PER_LEAD_,
    meetings: list,
    meetingsHappened: list.filter(function (m) { return m.happened; }).length,
    meetingsUpcoming: list.filter(function (m) { return !m.happened; }).length,
    excluded: excluded.map(function (m) { return { name: m.lead.name, date: m.lead.zoomDate, sheetReward: m.lead.reward }; }),
    bonusTotal: bonus,
    total: entered.length * BASE_PER_LEAD_ + bonus,
    currentTier: count === 0 ? 0 : (count <= 5 ? 1 : (count <= 10 ? 2 : 3)),
    toNextTier: nextTierAt ? nextTierAt - count : 0,
    nextTierAmount: nextTierAt ? tierAmount_(nextTierAt) : null,
  };
}
