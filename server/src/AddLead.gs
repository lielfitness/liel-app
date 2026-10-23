/**
 * הוספת ליד ידני (ליאל ושי).
 * שורה חדשה בסוף הגיליון: A היום, B שם, C טלפון, D מייל, E "ידני – <משתמש>", N "ליד חדש", T מקור, "עודכן לאחרונה" = עכשיו.
 * ההוספה היא append אטומי של Sheets API – לא מחשבים מספר שורה מראש, כך שליד שנכנס באותו רגע מ-Webflow לא נדרס.
 * לפני ההוספה: בדיקה אם הטלפון כבר קיים (אם כן – מחזירים אזהרה, וההוספה רק עם force).
 */

const USER_NAMES_BY_ROLE_ = { admin: 'ליאל', leads: 'שי' };

function actionAddLead_(req, ctx) {
  const name = String(req.name || '').trim();
  const phone = String(req.phone || '').trim();
  const email = String(req.email || '').trim();
  const source = String(req.source || '').trim();
  if (!name) throw apiError_('BAD_REQUEST', 'חסר שם');
  if (digits_(phone).length < 9) throw apiError_('BAD_REQUEST', 'מספר טלפון לא תקין');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw apiError_('BAD_REQUEST', 'כתובת מייל לא תקינה');
  const who = (ctx.cfg.names && ctx.cfg.names[ctx.email]) || USER_NAMES_BY_ROLE_[ctx.realRole] || ctx.email;

  // בדיקת כפילות לפי טלפון (מול הרשימה העדכנית)
  if (!req.force) {
    invalidateLeads_();
    const dups = cachedLeads_(ctx.cfg).leads.filter(function (l) { return phoneKey_(l.phone) && phoneKey_(l.phone) === phoneKey_(phone); });
    if (dups.length) {
      return { duplicate: dups.map(function (l) { return { id: l.id, name: l.name, entry: l.entry, status: l.status }; }) };
    }
  }

  let lead = null;
  withLock_(function () {
    const today = Utilities.formatDate(new Date(), TZ_, 'dd/MM/yyyy');
    const row = [];
    for (let i = 0; i < LAST_BASE_COL_; i++) row.push('');
    row[COL_.entry - 1] = today;
    row[COL_.name - 1] = name;
    row[COL_.phone - 1] = phone;
    row[COL_.email - 1] = email;
    row[COL_.ad - 1] = 'ידני – ' + who;
    row[COL_.status - 1] = 'ליד חדש';
    row[COL_.source - 1] = source;

    let rowNum = 0, upCol = 0;
    if (fastAvailable_()) {
      const id = ctx.cfg.leadsSheetId, t = "'" + LEADS_TAB_ + "'";
      // 1) הוספה אטומית בסוף (טקסט כמו שהוא – הטלפון נשאר עם 0 בהתחלה)
      const res = Sheets.Spreadsheets.Values.append({ values: [row] }, id, t + '!A:AF',
        { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
      const m = String(res.updates && res.updates.updatedRange || '').match(/![A-Z]+(\d+)/);
      rowNum = m ? Number(m[1]) : 0;
      // 2) תאריך אמיתי ב-A + "עודכן לאחרונה"
      const meta = Sheets.Spreadsheets.get(id, { ranges: [t + '!AG1:AZ1'], fields: 'sheets(properties(sheetId),data(rowData(values(formattedValue))))' });
      const sheet = meta.sheets[0];
      const hdr = ((((sheet.data[0] || {}).rowData || [])[0] || {}).values || []).map(function (c) { return normHeader_(c.formattedValue || ''); });
      const ui = hdr.indexOf(UPDATED_HEADER_);
      upCol = ui < 0 ? 0 : LAST_BASE_COL_ + 1 + ui;
      if (rowNum) {
        const reqs = [cellReq_(sheet.properties.sheetId, rowNum, COL_.entry, fastCell_(today, 'dd/MM/yyyy'))];
        if (upCol) reqs.push(cellReq_(sheet.properties.sheetId, rowNum, upCol, fastCell_(nowStamp_(), 'dd/MM/yyyy HH:mm')));
        Sheets.Spreadsheets.batchUpdate({ requests: reqs }, id);
      }
    } else {
      const sh = leadsSheet_(ctx.cfg);
      sh.appendRow(row);
      rowNum = sh.getLastRow();
      sh.getRange(rowNum, COL_.phone).setNumberFormat('@').setValue(phone);
      setDateCell_(sh, rowNum, COL_.entry, new Date());
      upCol = updatedCol_(sh);
      if (upCol) touch_(sh, rowNum, upCol);
    }
    if (!rowNum) throw apiError_('ERROR', 'הליד נוסף, אבל לא הצלחתי לזהות את השורה – רענני את הרשימה');

    const disp = row.slice();
    while (disp.length < Math.max(upCol, LAST_BASE_COL_)) disp.push('');
    if (upCol) disp[upCol - 1] = nowStamp_();
    const built = buildLead_(rowNum, disp, disp, null, upCol, 0);
    lead = built ? publicLead_(built) : null;
  });
  try {
    const appUrl = String(ctx.cfg.appUrl || '').replace(/\/?$/, '/');
    sendTelegramLeads_('🆕 <b>ליד חדש</b> (נוסף ידנית ע״י ' + esc_(who) + ')\n' + esc_(name) + '\n' + esc_(phone) +
      (email ? '\n' + esc_(email) : '') + (source ? '\nמקור: ' + esc_(source) : ''),
      lead ? [{ text: 'פתח כרטיס ליד', url: appUrl + '#/lead/' + lead.id }] : []);
  } catch (e) { console.warn('telegram: ' + e); }
  // התראה באפליקציה – לכל מי שמקבל לידים, חוץ ממי שהוסיף
  notify_('lead_new', { name: name, link: lead ? '#/lead/' + lead.id : '#/leads' }, { exclude: ctx.email });
  return { lead: lead };
}

function cellReq_(sheetId, row, col, p) {
  return { updateCells: {
    range: { sheetId: sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col - 1, endColumnIndex: col },
    rows: [{ values: [p.cell] }], fields: p.fields,
  } };
}

/** ערכי "מקור הגעה" (T) הקיימים, לפי שכיחות – לרשימה הנפתחת. */
function leadSources_(leads) {
  const count = {};
  leads.forEach(function (l) { const s = String(l.source || '').trim(); if (s) count[s] = (count[s] || 0) + 1; });
  return Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
}
