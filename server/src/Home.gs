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
      newStatus: leads.filter(function (l) { return l.statusKey === 'ליד חדש' || !l.statusKey; }).length,
      enteredToday: leads.filter(function (l) { return l.entry && parseIso_(l.entry).getTime() === today; }).length,
      enteredWeek: leads.filter(function (l) { return l.entry && parseIso_(l.entry).getTime() >= weekAgo; }).length,
      untreated: leads.filter(function (l) { return l.untreated; }).length,
      zoomsWeek: leads.filter(function (l) {
        const t = l.zoomDate ? parseIso_(l.zoomDate).getTime() : 0;
        return t >= today && t < inWeek;
      }).map(function (l) { return { id: l.id, row: l.row, name: l.name, date: l.zoomDate }; })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; }),
      // "ממתינים – לחזור אליהם אחרי פגישה": P = ממתין, הישן ראשון
      waiting: leads.filter(function (l) { return String(l.zoomResult || '').trim() === 'ממתין'; })
        .map(function (l) { return { id: l.id, name: l.name, date: l.zoomDate, notes: l.notes, phone: l.phone }; })
        .sort(function (a, b) { return (a.date || '9999') < (b.date || '9999') ? -1 : 1; }),
    },
    zoomAlerts: readJsonProp_(ZOOM_ALERTS_KEY_, []).length,
    reminders: (function () { try { return remList_('home', ctx.email); } catch (e) { console.warn('home reminders: ' + e); return []; } })(),
    health: healthCheck_(),
    stage2: finHomeCounts_(),
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
  const year = ss.getSheetByName(String(new Date().getFullYear()));
  // עדכון פיננסים אחרון: לשונית השנה, K17
  const lastUpdate = year ? year.getRange('K17').getDisplayValue() : '';
  // סיכום החודש הנוכחי מהלשונית השנתית (שורה 2 = ינואר). G הוצאות כולל מע"מ, F אחרי מע"מ, I הכנסות, H אחרי מע"מ
  let month = null;
  if (year) {
    const row = new Date().getMonth() + 2;
    const v = year.getRange(row, 6, 1, 4).getValues()[0];   // F G H I
    const num = function (x) { return typeof x === 'number' ? x : 0; };
    month = { expensesNet: num(v[0]), expenses: num(v[1]), incomeNet: num(v[2]), income: num(v[3]) };
  }
  // הורדת פגישות אחרונה: "מעקב ביטולים (מערכת)" I1 (כותב הסקריפט של הפגישות)
  const track = ss.getSheetByName('מעקב ביטולים (מערכת)');
  const lastMeetings = track ? String(track.getRange('I1').getDisplayValue() || '').trim() : '';
  return { lastFinUpdate: lastUpdate, lastMeetingsRun: lastMeetings, month: month };
}
