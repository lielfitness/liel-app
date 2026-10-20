/**
 * מסך הבית של ליאל ("תמונת מצב"). מגיליון הפיננסים – קריאה בלבד.
 */

function actionHome_(req, ctx) {
  const cfg = ctx.cfg;
  const leads = cachedLeads_(cfg).leads;
  const today = todayMidnight_().getTime();
  const weekAgo = today - 6 * DAY_MS_;
  const inWeek = today + 7 * DAY_MS_;

  const out = {
    leads: {
      newStatus: leads.filter(function (l) { return l.status === 'ליד חדש' || !l.status; }).length,
      enteredToday: leads.filter(function (l) { return l.entry && parseIso_(l.entry).getTime() === today; }).length,
      enteredWeek: leads.filter(function (l) { return l.entry && parseIso_(l.entry).getTime() >= weekAgo; }).length,
      untreated: leads.filter(function (l) { return l.untreated; }).length,
      zoomsWeek: leads.filter(function (l) {
        const t = l.zoomDate ? parseIso_(l.zoomDate).getTime() : 0;
        return t >= today && t < inWeek;
      }).map(function (l) { return { id: l.id, row: l.row, name: l.name, date: l.zoomDate }; })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; }),
    },
    zoomAlerts: readJsonProp_(ZOOM_ALERTS_KEY_, []).length,
    fin: null,
    finError: '',
  };

  try {
    out.fin = financeSnapshot_(cfg);
  } catch (e) {
    out.finError = 'לא הצלחתי לקרוא את גיליון הפיננסים: ' + (e.message || e);
  }
  return out;
}

function financeSnapshot_(cfg) {
  const ss = SpreadsheetApp.openById(cfg.finSheetId);

  // מאמנים עם ≤2 פגישות שנותרו (תפעול: A שם, B מייל, C חבילה, D נותרו)
  const ops = ss.getSheetByName('תפעול');
  const coaches = [];
  if (ops && ops.getLastRow() >= 2) {
    ops.getRange(2, 1, ops.getLastRow() - 1, 4).getDisplayValues().forEach(function (r) {
      const left = String(r[3]).trim();
      if (r[0] && left !== '' && !isNaN(Number(left)) && Number(left) <= 2) {
        coaches.push({ name: r[0], package: r[2], left: Number(left) });
      }
    });
  }

  // שורות "לבדיקה" בתנועות (עמודה G)
  const tx = ss.getSheetByName('תנועות');
  let toReview = 0;
  if (tx && tx.getLastRow() >= 2) {
    tx.getRange(2, 7, tx.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
      if (String(r[0]).trim() === 'לבדיקה') toReview++;
    });
  }

  // עדכון פיננסים אחרון: לשונית השנה, K17
  const year = ss.getSheetByName(String(new Date().getFullYear()));
  const lastUpdate = year ? year.getRange('K17').getDisplayValue() : '';

  return {
    coachesLow: coaches.sort(function (a, b) { return a.left - b.left; }),
    toReview: toReview,
    lastFinUpdate: lastUpdate,
  };
}
