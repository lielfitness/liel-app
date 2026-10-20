/* Liel Fitness – אפליקציית ניהול (שלב 1: לידים + בית) */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* פרטי */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* פרטי */ } },
  };

  const state = {
    session: LS.get('lf_session'),
    email: LS.get('lf_email') || '',
    role: LS.get('lf_role') || '',
    bookingUrl: '',
    leads: null,          // מטמון רשימת הלידים
    meta: null,           // statuses, zoomResults, hasUpdatedCol
    alertsCount: 0,
    filter: LS.get('lf_filter') || 'active',
    search: '',
    month: null,
  };

  const $app = document.getElementById('app');
  const FINAL = ['נסגר', 'לא מעוניין', 'לא רלוונטי', 'Ghosting'];

  // ---------- עזרים ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtIso(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  function fmtTs(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function daysAgo(ms) {
    if (!ms) return null;
    return Math.floor((Date.now() - ms) / 864e5);
  }
  function ils(n) { return '₪' + Number(n || 0).toLocaleString('he-IL'); }
  function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = ''; }, isError ? 4500 : 2200);
  }
  function telHref(phone) {
    const d = String(phone || '').replace(/[^\d+]/g, '');
    return d ? 'tel:' + d : '';
  }
  function waNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('972')) return d;
    if (d.startsWith('0')) return '972' + d.slice(1);
    if (d.length === 9 && d.startsWith('5')) return '972' + d;
    return d;
  }
  function waHref(lead) {
    const n = waNumber(lead.phone);
    if (!n) return '';
    const first = String(lead.name || '').split(/[\s|]+/)[0] || '';
    const me = (CFG.senderNames || {})[state.role] || '';
    const text = String(CFG.waTemplate || '').replace('{name}', first).replace('{me}', me);
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  }
  function statusPill(s) {
    if (!s) return '<span class="pill warn">ללא סטטוס</span>';
    let cls = '';
    if (s === 'Ghosting') cls = 'ghost';
    else if (s === 'נסגר') cls = 'hot';
    else if (FINAL.includes(s)) cls = 'final';
    else if (s === 'זום נקבע') cls = 'hot';
    else if (s === 'ליד חדש') cls = 'warn';
    return `<span class="pill ${cls}">${esc(s)}</span>`;
  }
  function isAdmin() { return state.role === 'admin'; }

  // ---------- API ----------
  async function api(action, params) {
    if (!CFG.apiUrl) throw new Error('האתר עוד לא מחובר לשרת (חסר apiUrl ב-config.js)');
    const body = Object.assign({ action, session: state.session }, params || {});
    let res;
    try {
      res = await fetch(CFG.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('אין חיבור לשרת. בדקו אינטרנט ונסו שוב.');
    }
    let out;
    try { out = await res.json(); } catch (e) { throw new Error('תשובה לא תקינה מהשרת'); }
    if (!out.ok) {
      if (out.code === 'AUTH') { logout(true); }
      const err = new Error(out.error || 'שגיאה');
      err.code = out.code;
      throw err;
    }
    return action === 'login' ? out : out.data;
  }

  // ---------- כניסה ----------
  function logout(silent) {
    state.session = null; state.role = ''; state.email = ''; state.leads = null;
    ['lf_session', 'lf_role', 'lf_email'].forEach(LS.del);
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (e) { /* */ }
    if (!silent) location.hash = '';
    renderLogin();
  }

  function renderLogin(msg) {
    $app.innerHTML = `
      <div class="login">
        <div class="logo-mark">LF</div>
        <h1>Liel Fitness</h1>
        <div class="muted">ניהול לידים ועסק</div>
        <div id="gbtn"></div>
        ${msg ? `<div class="notice">${esc(msg)}</div>` : ''}
        ${!CFG.clientId ? '<div class="notice">חסר clientId ב-config.js</div>' : ''}
      </div>`;
    if (!CFG.clientId) return;
    const init = () => {
      google.accounts.id.initialize({
        client_id: CFG.clientId,
        callback: onGoogleCredential,
        auto_select: true,
        ux_mode: 'popup',
        use_fedcm_for_prompt: true,
      });
      google.accounts.id.renderButton(document.getElementById('gbtn'), {
        theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'he', width: 260,
      });
    };
    if (window.google && google.accounts && google.accounts.id) init();
    else window.addEventListener('load', () => (window.google ? init() : renderLogin('לא הצלחתי לטעון את הכניסה של גוגל')), { once: true });
  }

  async function onGoogleCredential(resp) {
    $app.innerHTML = '<div class="splash"><div class="spinner"></div></div>';
    try {
      const out = await api('login', { idToken: resp.credential });
      state.session = out.session; state.role = out.role; state.email = out.email;
      LS.set('lf_session', out.session); LS.set('lf_role', out.role); LS.set('lf_email', out.email);
      await boot();
    } catch (e) {
      renderLogin(e.message);
    }
  }

  // ---------- מסגרת וניווט ----------
  function navItems() {
    const items = [];
    if (isAdmin()) items.push({ h: '#/home', ico: '🏠', t: 'בית' });
    items.push({ h: '#/leads', ico: '👥', t: 'לידים' });
    items.push({ h: '#/untreated', ico: '⏰', t: 'לא טופלו', badge: untreatedCount() });
    items.push({ h: '#/ghosting', ico: '👻', t: 'גוסטינג' });
    items.push({ h: '#/month', ico: '💰', t: isAdmin() ? 'שכר שי' : 'החודש שלי' });
    return items;
  }
  function untreatedCount() {
    return state.leads ? state.leads.filter((l) => l.untreated).length : 0;
  }

  function shell(title, content, opts) {
    opts = opts || {};
    const cur = '#/' + (location.hash.replace(/^#\/?/, '').split('/')[0] || '');
    const nav = navItems();
    const link = (n) => `<a href="${n.h}" class="${cur === n.h ? 'active' : ''}"><span class="ico">${n.ico}</span><span>${esc(n.t)}</span>${n.badge ? `<span class="badge">${n.badge}</span>` : ''}</a>`;
    $app.innerHTML = `
      <header class="topbar">
        ${opts.back ? `<button class="icon-btn" data-act="back" aria-label="חזרה">→</button>` : ''}
        <h1>${esc(title)}</h1>
        <nav class="topnav">${nav.map(link).join('')}</nav>
        <span class="spacer"></span>
        ${state.alertsCount ? `<a class="icon-btn" href="#/zooms" title="זומים לשיוך" style="text-decoration:none">📅<span class="badge">${state.alertsCount}</span></a>` : ''}
        <button class="icon-btn" data-act="refresh" aria-label="רענון" title="רענון">🔄</button>
        <button class="icon-btn" data-act="logout" aria-label="יציאה" title="יציאה (${esc(state.email)})" style="font-size:14px">יציאה</button>
      </header>
      <main>${content}</main>
      <nav class="bottomnav">${nav.map(link).join('')}</nav>`;
    $app.querySelector('[data-act="refresh"]').onclick = () => { state.leads = null; route(); refreshAlerts(); };
    $app.querySelector('[data-act="logout"]').onclick = () => { if (confirm('לצאת מהאפליקציה?')) logout(); };
    const back = $app.querySelector('[data-act="back"]');
    if (back) back.onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/leads'));
  }

  function loading(title) { shell(title, '<div class="spinner"></div>'); }
  function errorView(title, e) {
    shell(title, `<div class="notice">${esc(e.message || e)}</div><button class="btn secondary" onclick="location.reload()">נסו שוב</button>`);
  }

  async function ensureLeads(force) {
    if (state.leads && !force) return state.leads;
    const d = await api('listLeads');
    state.leads = d.leads;
    state.meta = { statuses: d.statuses, zoomResults: d.zoomResults, hasUpdatedCol: d.hasUpdatedCol };
    return state.leads;
  }

  async function refreshAlerts() {
    try {
      const d = await api('zoomAlerts');
      const n = d.alerts.length;
      if (n !== state.alertsCount) { state.alertsCount = n; route(); }
    } catch (e) { /* לא קריטי */ }
  }

  // ---------- מסך: לידים ----------
  const FILTERS = [
    { k: 'active', t: 'פעילים', f: (l) => !FINAL.includes(l.status) },
    { k: 'all', t: 'הכל', f: () => true },
  ];

  function sortNewest(a, b) {
    if (a.entry !== b.entry) return (b.entry || '') < (a.entry || '') ? -1 : 1;
    return b.row - a.row;
  }

  function matchSearch(l, q) {
    if (!q) return true;
    q = q.toLowerCase();
    const digits = q.replace(/\D/g, '');
    return [l.name, l.email, l.ad, l.source].some((x) => String(x || '').toLowerCase().includes(q)) ||
      (digits.length >= 3 && String(l.phone || '').replace(/\D/g, '').includes(digits));
  }

  function leadCardsHtml(list, opts) {
    opts = opts || {};
    if (!list.length) return `<div class="empty">${esc(opts.empty || 'אין לידים להצגה')}</div>`;
    const cards = list.map((l) => {
      const idle = daysAgo(l.lastActivity);
      const extra = opts.idle
        ? `<span>⏰ ${idle == null ? 'אין תאריך פעילות' : `ללא עדכון ${idle} ימים`}</span>`
        : `<span>${esc(fmtIso(l.entry) || l.entryRaw)}</span>`;
      return `
        <a class="card lead-card ${l.untreated ? 'untreated' : ''}" href="#/lead/${esc(l.id)}">
          <div class="top"><div class="name">${esc(l.name || '(ללא שם)')}</div>${statusPill(l.status)}</div>
          <div class="meta">
            ${extra}
            ${l.phone ? `<span class="ltr">${esc(l.phone)}</span>` : ''}
            <span>📞 ${l.calls}/3</span><span>💬 ${l.was}/3</span>
            ${l.zoomDate ? `<span>🎥 ${esc(fmtIso(l.zoomDate))}</span>` : ''}
          </div>
        </a>`;
    }).join('');
    const rows = list.map((l) => `
      <tr class="${l.untreated ? 'untreated' : ''}" data-id="${esc(l.id)}">
        <td>${esc(fmtIso(l.entry) || l.entryRaw)}</td>
        <td><b>${esc(l.name)}</b></td>
        <td><span class="ltr">${esc(l.phone)}</span></td>
        <td>${statusPill(l.status)}</td>
        <td>${l.calls}/3</td><td>${l.was}/3</td>
        <td>${esc(fmtIso(l.zoomDate))}</td>
        <td>${esc(l.ad || l.source)}</td>
        <td>${opts.idle ? (daysAgo(l.lastActivity) == null ? '—' : daysAgo(l.lastActivity) + ' ימים') : esc(fmtTs(l.updatedAt))}</td>
      </tr>`).join('');
    return `
      <div class="list leads">${cards}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>נכנס</th><th>שם</th><th>טלפון</th><th>סטטוס</th><th>שיחות</th><th>WA</th><th>זום</th><th>מודעה</th><th>${opts.idle ? 'ללא עדכון' : 'עודכן'}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  function bindTableRows() {
    $app.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      tr.onclick = () => { location.hash = '#/lead/' + tr.dataset.id; };
    });
  }

  async function viewLeads() {
    loading('לידים');
    try { await ensureLeads(); } catch (e) { return errorView('לידים', e); }
    const statuses = state.meta.statuses;
    const counts = {};
    state.leads.forEach((l) => { counts[l.status || ''] = (counts[l.status || ''] || 0) + 1; });
    const chips = FILTERS.map((f) => ({ k: f.k, t: f.t, n: state.leads.filter(f.f).length }))
      .concat(statuses.filter((s) => counts[s]).map((s) => ({ k: 's:' + s, t: s, n: counts[s] })));

    shell('לידים', `
      <input class="search" type="search" placeholder="חיפוש לפי שם, טלפון או מייל" value="${esc(state.search)}" id="q" autocomplete="off">
      <div class="chips">${chips.map((c) => `<button class="chip ${state.filter === c.k ? 'on' : ''}" data-f="${esc(c.k)}">${esc(c.t)}<span class="n">${c.n}</span></button>`).join('')}</div>
      <div id="results"></div>`);

    const draw = () => {
      const f = state.filter;
      let list = state.leads.filter((l) => {
        if (f === 'all') return true;
        if (f === 'active') return !FINAL.includes(l.status);
        return f.startsWith('s:') && l.status === f.slice(2);
      });
      list = list.filter((l) => matchSearch(l, state.search)).sort(sortNewest);
      document.getElementById('results').innerHTML = leadCardsHtml(list);
      bindTableRows();
    };
    draw();
    const q = document.getElementById('q');
    q.oninput = () => { state.search = q.value.trim(); draw(); };
    $app.querySelectorAll('.chip[data-f]').forEach((b) => {
      b.onclick = () => {
        state.filter = b.dataset.f; LS.set('lf_filter', state.filter);
        $app.querySelectorAll('.chip[data-f]').forEach((x) => x.classList.toggle('on', x === b));
        draw();
      };
    });
  }

  // ---------- מסך: לא טופלו ----------
  async function viewUntreated() {
    loading('לא טופלו');
    try { await ensureLeads(); } catch (e) { return errorView('לא טופלו', e); }
    const list = state.leads.filter((l) => l.untreated)
      .sort((a, b) => (a.lastActivity || 0) - (b.lastActivity || 0));
    shell('לא טופלו', `
      <div class="notice info">לידים פעילים בלי שום עדכון יומיים ומעלה. הוותיקים ראשונים.</div>
      ${!state.meta.hasUpdatedCol ? '<div class="notice">עמודת "עודכן לאחרונה" עוד לא קיימת בגיליון, אז החישוב לפי תאריכי כניסה/שיחות בלבד.</div>' : ''}
      ${leadCardsHtml(list, { idle: true, empty: 'אין לידים שמחכים – כל הכבוד! 🎉' })}`);
    bindTableRows();
  }

  // ---------- מסך: כרטיס ליד ----------
  async function viewLead(id) {
    loading('כרטיס ליד');
    try { await ensureLeads(); } catch (e) { return errorView('כרטיס ליד', e); }
    let lead = state.leads.find((l) => l.id === id);
    if (!lead) {
      try { await ensureLeads(true); } catch (e) { return errorView('כרטיס ליד', e); }
      lead = state.leads.find((l) => l.id === id);
    }
    if (!lead) return shell('כרטיס ליד', '<div class="empty">הליד לא נמצא. אולי הפרטים שלו שונו בגיליון.</div>', { back: true });
    renderLead(lead);
  }

  function infoRow(label, val, ltr) {
    if (!val) return '';
    return `<dt>${esc(label)}</dt><dd>${ltr ? `<span class="ltr">${esc(val)}</span>` : esc(val)}</dd>`;
  }

  function renderLead(lead) {
    const m = state.meta;
    const tel = telHref(lead.phone), wa = waHref(lead);
    const opt = (list, cur) => ['<option value=""></option>'].concat(list.map((s) => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`)).join('');
    const statusList = m.statuses.includes(lead.status) || !lead.status ? m.statuses : [lead.status].concat(m.statuses);

    shell(lead.name || 'כרטיס ליד', `
      <div class="lead-layout">
        <div>
          <div class="card">
            <div class="lead-head">
              <div class="grow">
                <h2>${esc(lead.name || '(ללא שם)')}</h2>
                <div class="muted small" style="margin-top:4px">נכנס ${esc(fmtIso(lead.entry) || lead.entryRaw)}${lead.updatedAt ? ' · עודכן ' + esc(fmtTs(lead.updatedAt)) : ''}</div>
              </div>
              ${statusPill(lead.status)}
            </div>
            <div class="quick">
              <a class="btn" ${tel ? `href="${esc(tel)}"` : 'disabled'}>📞 חיוג</a>
              <a class="btn green" ${wa ? `href="${esc(wa)}" target="_blank" rel="noopener"` : 'disabled'}>💬 ווטסאפ</a>
              <button class="btn secondary" data-act="call" ${lead.calls >= 3 ? 'disabled' : ''}>✔︎ ניסיון שיחה <span class="counter">${lead.calls}/3</span></button>
              <button class="btn secondary" data-act="wa" ${lead.was >= 3 ? 'disabled' : ''}>✔︎ נשלח WA <span class="counter">${lead.was}/3</span></button>
            </div>
            ${state.bookingUrl ? `<a class="btn secondary" style="width:100%;margin-top:10px" href="${esc(state.bookingUrl)}" target="_blank" rel="noopener">🎥 קביעת זום (פגישת אפיון)</a>` : ''}
          </div>

          <div class="section-title">עדכון</div>
          <div class="card form" id="form">
            <div class="field">
              <label>סטטוס</label>
              <div class="status-grid">${statusList.map((s) => `<button type="button" class="chip ${s === lead.status ? 'on' : ''}" data-status="${esc(s)}">${esc(s)}</button>`).join('')}</div>
            </div>
            <div class="field"><label for="f-callResult">תוצאת שיחה</label><input id="f-callResult" value="${esc(lead.callResult)}" placeholder="למשל: לא ענה / ביקש לחזור מחר"></div>
            <div class="field"><label for="f-summary">סיכום שיחה</label><textarea id="f-summary">${esc(lead.summary)}</textarea></div>
            <div class="field"><label for="f-notes">הערות</label><textarea id="f-notes">${esc(lead.notes)}</textarea></div>
            <div class="row">
              <div class="field grow"><label for="f-zoomDate">תאריך זום</label><input id="f-zoomDate" type="date" value="${esc(lead.zoomDate)}"></div>
              <div class="field grow"><label for="f-zoomResult">תוצאת זום</label><select id="f-zoomResult">${opt(m.zoomResults, lead.zoomResult)}</select></div>
            </div>
            ${lead.zoomDateRaw && !lead.zoomDate ? `<div class="notice small">בגיליון כתוב בתאריך הזום: "${esc(lead.zoomDateRaw)}" – לא הצלחתי לפענח.</div>` : ''}
          </div>
          <div class="savebar">
            <button class="btn" data-act="save" disabled>שמירה</button>
          </div>
        </div>

        <div>
          <div class="section-title">פרטים</div>
          <div class="card">
            <dl class="info">
              ${infoRow('טלפון', lead.phone, true)}
              ${infoRow('מייל', lead.email, true)}
              ${infoRow('מודעה', lead.ad)}
              ${infoRow('מקור הגעה', lead.source)}
              ${infoRow('גיל', lead.age)}
              ${infoRow('הסמכה', lead.cert)}
              ${infoRow('הקושי הגדול', lead.difficulty)}
              ${infoRow('מה רוצה לשפר', lead.improve)}
              ${infoRow('מה ישתנה', lead.change)}
              ${infoRow('אינסטגרם', lead.insta)}
            </dl>
          </div>
          <div class="section-title">היסטוריית פניות</div>
          <div class="card">
            <dl class="info">
              ${infoRow('ניסיון 1', [lead.call1Date, lead.call1Time].filter(Boolean).join(' · '))}
              ${infoRow('ניסיון 2', lead.call2)}
              ${infoRow('ניסיון 3', lead.call3)}
              ${infoRow('WA #1', lead.wa1)}
              ${infoRow('WA #2', lead.wa2)}
              ${infoRow('WA #3', lead.wa3)}
              ${infoRow('תגמול מגיע?', lead.reward)}
            </dl>
            ${!lead.calls && !lead.was ? '<div class="muted small">עוד אין פניות</div>' : ''}
          </div>
        </div>
      </div>`, { back: true });

    // --- טופס ---
    let status = lead.status;
    const saveBtn = $app.querySelector('[data-act="save"]');
    const ids = ['callResult', 'summary', 'notes', 'zoomDate', 'zoomResult'];
    const collect = () => {
      const f = {};
      if (status !== lead.status) f.status = status;
      ids.forEach((k) => {
        const v = document.getElementById('f-' + k).value.trim();
        if (v !== String(lead[k] || '').trim()) f[k] = v;
      });
      return f;
    };
    const dirty = () => { saveBtn.disabled = !Object.keys(collect()).length; };
    ids.forEach((k) => { document.getElementById('f-' + k).addEventListener('input', dirty); });
    $app.querySelectorAll('[data-status]').forEach((b) => {
      b.onclick = () => {
        status = b.dataset.status === status ? lead.status : b.dataset.status;
        $app.querySelectorAll('[data-status]').forEach((x) => x.classList.toggle('on', x.dataset.status === status));
        dirty();
      };
    });

    saveBtn.onclick = async () => {
      const fields = collect();
      if (!Object.keys(fields).length) return;
      if (fields.status === 'Ghosting' && !confirm('לסמן Ghosting? הליד יועתק גם ללשונית הגוסטינג.')) return;
      saveBtn.disabled = true; saveBtn.textContent = 'שומר…';
      try {
        const d = await api('updateLead', { row: lead.row, id: lead.id, fields });
        replaceLead(lead.id, d.lead);
        let msg = 'נשמר ✓';
        if (d.ghost) msg += d.ghost.copied ? ' · הועתק לגוסטינג' : ' · ' + d.ghost.reason;
        toast(msg, d.ghost && !d.ghost.copied && !/כבר קיים/.test(d.ghost.reason));
        if (d.lead) renderLead(d.lead);
      } catch (e) {
        toast(e.message, true);
        saveBtn.disabled = false; saveBtn.textContent = 'שמירה';
      }
    };

    $app.querySelectorAll('[data-act="call"],[data-act="wa"]').forEach((b) => {
      b.onclick = async () => {
        if (Object.keys(collect()).length && !confirm('יש שינויים שלא נשמרו בטופס. להמשיך בלי לשמור אותם?')) return;
        b.disabled = true;
        try {
          const d = await api('markAttempt', { row: lead.row, id: lead.id, kind: b.dataset.act });
          replaceLead(lead.id, d.lead);
          toast(b.dataset.act === 'wa' ? 'סומן WA ✓' : 'סומן ניסיון שיחה ✓');
          if (d.lead) renderLead(d.lead);
        } catch (e) {
          toast(e.message, true);
          b.disabled = false;
        }
      };
    });
  }

  function replaceLead(oldId, lead) {
    if (!state.leads) return;
    const i = state.leads.findIndex((l) => l.id === oldId);
    if (lead && i >= 0) state.leads[i] = lead;
    else state.leads = null;
    if (lead && oldId !== lead.id) history.replaceState(null, '', '#/lead/' + lead.id);
  }

  // ---------- מסך: גוסטינג ----------
  async function viewGhosting() {
    loading('גוסטינג');
    let d;
    try { d = await api('listGhosting'); } catch (e) { return errorView('גוסטינג', e); }
    const rows = d.rows.slice().reverse();
    shell('גוסטינג', `
      <div class="muted small">${rows.length} לידים · החדשים למעלה</div>
      ${rows.length ? `<div class="ghost-table"><table>
        <thead><tr>${d.headers.map((h) => `<th>${esc(h || '—')}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td>${/טלפון/.test(d.headers[i]) ? `<a class="ltr" href="${esc(telHref(c))}">${esc(c)}</a>` : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">הלשונית ריקה</div>'}`);
  }

  // ---------- מסך: החודש שלי ----------
  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }
  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  async function viewMonth() {
    const title = isAdmin() ? 'שכר שי' : 'החודש שלי';
    if (!state.month) { const n = new Date(); state.month = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); }
    loading(title);
    let d;
    try { d = await api('month', { month: state.month }); } catch (e) { return errorView(title, e); }
    const n = d.meetings.length;
    const from = n < 6 ? 0 : 5, to = n < 6 ? 6 : 11;
    const pct = d.toNextTier ? Math.round(((n - from) / (to - from)) * 100) : 100;

    shell(title, `
      <div class="month-nav">
        <button class="btn ghost small" data-m="-1" aria-label="חודש קודם">→</button>
        <h2>${esc(monthLabel(d.month))}</h2>
        <button class="btn ghost small" data-m="1" aria-label="חודש הבא">←</button>
      </div>
      <div class="tiles">
        <div class="card tile big"><div class="num">${ils(d.total)}</div><div class="lbl">סה"כ החודש</div></div>
        <div class="card tile"><div class="num">${d.leadsCount}</div><div class="lbl">לידים נכנסו × ${ils(d.basePerLead)} = ${ils(d.baseTotal)}</div></div>
        <div class="card tile"><div class="num">${d.meetings.length}</div><div class="lbl">זומים החודש · ${d.meetingsHappened} התקיימו · ${d.meetingsUpcoming} מתוכננים</div></div>
        <div class="card tile"><div class="num">${ils(d.bonusTotal)}</div><div class="lbl">בונוס פגישות</div></div>
        <div class="card tile"><div class="num">${d.currentTier || '—'}</div><div class="lbl">מדרגה נוכחית</div></div>
      </div>
      <div class="card" style="margin-top:10px">
        ${d.toNextTier
          ? `<b>עוד ${d.toNextTier} ${d.toNextTier === 1 ? 'פגישה' : 'פגישות'}</b> למדרגה הבאה (${ils(d.nextTierAmount)} לפגישה)`
          : '<b>את במדרגה העליונה 🚀</b> (120 ₪ לפגישה)'}
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="muted small" style="margin-top:8px">פגישות 1 עד 5: 80 ₪ · פגישות 6 עד 10: 100 ₪ · מ-11 ומעלה: 120 ₪<br>נספר לפי תאריך הזום</div>
      </div>

      <div class="section-title">פירוט פגישות</div>
      ${d.meetings.length ? `<div class="mlist">${d.meetings.map((m) => `
        <a class="card mrow" href="#/lead/${esc(m.id)}" style="text-decoration:none;color:inherit">
          <div class="n">${m.n}</div>
          <div class="grow">
            <div><b>${esc(m.name)}</b></div>
            <div class="muted small">${esc(fmtIso(m.date))} · מדרגה ${m.tier}${m.happened ? '' : ' · מתוכנן'}${m.zoomResult ? ' · ' + esc(m.zoomResult) : ''}</div>
            ${m.mismatch ? `<div class="small" style="color:var(--warn)">בגיליון כתוב "${esc(m.sheetReward)}"</div>` : ''}
          </div>
          <div class="amt">${ils(m.amount)}</div>
        </a>`).join('')}</div>` : '<div class="empty">עוד אין זומים בחודש הזה</div>'}
      ${d.excluded.length ? `<div class="section-title">לא נספרו (תגמול "לא")</div>
        <div class="card small">${d.excluded.map((x) => `${esc(x.name)} · ${esc(fmtIso(x.date))}`).join('<br>')}</div>` : ''}`);

    $app.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => { state.month = shiftMonth(state.month, Number(b.dataset.m)); viewMonth(); };
    });
  }

  // ---------- מסך: זומים לשיוך ----------
  async function viewZooms() {
    loading('זומים לשיוך');
    let d;
    try { d = await api('zoomAlerts'); await ensureLeads(); } catch (e) { return errorView('זומים לשיוך', e); }
    state.alertsCount = d.alerts.length;
    const alerts = d.alerts.slice().sort((a, b) => a.start - b.start);
    shell('זומים לשיוך', alerts.length ? `
      <div class="notice info">אירועי "פגישת אפיון" שלא שויכו אוטומטית לליד. בחרו ליד כדי למלא את תאריך הזום.</div>
      <div class="mlist">${alerts.map((a) => `
        <div class="card" data-key="${esc(a.key)}">
          <div class="row"><b class="grow">${esc(a.name || a.title)}</b><span class="pill">${esc(fmtTs(a.start))}</span></div>
          <div class="muted small" style="margin-top:4px">${esc(a.reason)}</div>
          ${(a.emails || []).length || (a.phones || []).length ? `<div class="small ltr" style="margin-top:4px">${esc([].concat(a.emails || [], a.phones || []).join(' · '))}</div>` : ''}
          <input class="search" style="margin-top:10px" placeholder="חפשו ליד לשיוך…" data-pick>
          <div class="picker"></div>
          <div class="row" style="margin-top:8px">
            ${a.leadId ? `<button class="btn small" data-assign="${esc(a.leadId)}">שייך ל${esc((state.leads.find((l) => l.id === a.leadId) || {}).name || 'ליד שנמצא')} (עדכון תאריך)</button>` : ''}
            <button class="btn ghost small" data-dismiss>התעלם</button>
          </div>
        </div>`).join('')}</div>` : '<div class="empty">אין זומים שמחכים לשיוך ✓</div>');

    $app.querySelectorAll('[data-key]').forEach((card) => {
      const key = card.dataset.key;
      const assign = async (leadId) => {
        const l = state.leads.find((x) => x.id === leadId);
        if (!l || !confirm(`לשייך את הזום ל${l.name}?`)) return;
        try {
          await api('assignZoom', { key, row: l.row, id: l.id });
          state.leads = null; toast('שויך ✓'); viewZooms();
        } catch (e) { toast(e.message, true); }
      };
      const inp = card.querySelector('[data-pick]');
      const picker = card.querySelector('.picker');
      inp.oninput = () => {
        const q = inp.value.trim();
        const hits = q.length < 2 ? [] : state.leads.filter((l) => matchSearch(l, q)).sort(sortNewest).slice(0, 8);
        picker.innerHTML = hits.map((l) => `<button data-lid="${esc(l.id)}">${esc(l.name)} · <span class="ltr">${esc(l.phone)}</span> · ${esc(fmtIso(l.entry))}</button>`).join('');
        picker.querySelectorAll('[data-lid]').forEach((b) => { b.onclick = () => assign(b.dataset.lid); });
      };
      const ab = card.querySelector('[data-assign]');
      if (ab) ab.onclick = () => assign(ab.dataset.assign);
      card.querySelector('[data-dismiss]').onclick = async () => {
        if (!confirm('להתעלם מהזום הזה? הוא לא ישויך לאף ליד.')) return;
        try { await api('dismissZoom', { key }); toast('הוסר'); viewZooms(); } catch (e) { toast(e.message, true); }
      };
    });
  }

  // ---------- מסך: בית (ליאל) ----------
  async function viewHome() {
    loading('תמונת מצב');
    let d;
    try { d = await api('home'); } catch (e) { return errorView('תמונת מצב', e); }
    state.alertsCount = d.zoomAlerts;
    const L = d.leads, F = d.fin;
    shell('תמונת מצב', `
      <div class="section-title" style="margin-top:4px">לידים</div>
      <div class="tiles">
        <a class="card tile" href="#/leads" data-filter="s:ליד חדש"><div class="num">${L.newStatus}</div><div class="lbl">בסטטוס "ליד חדש"</div></a>
        <a class="card tile ${L.untreated ? 'alert' : ''}" href="#/untreated"><div class="num">${L.untreated}</div><div class="lbl">לא טופלו יומיים+</div></a>
        <a class="card tile" href="#/leads" data-filter="all"><div class="num">${L.enteredToday}</div><div class="lbl">נכנסו היום · ${L.enteredWeek} השבוע</div></a>
        <a class="card tile ${d.zoomAlerts ? 'alert' : ''}" href="#/zooms"><div class="num">${d.zoomAlerts}</div><div class="lbl">זומים לשיוך ידני</div></a>
      </div>

      <div class="section-title">זומים ב-7 הימים הקרובים (${L.zoomsWeek.length})</div>
      ${L.zoomsWeek.length ? `<div class="mlist">${L.zoomsWeek.map((z) => `
        <a class="card mrow" href="#/lead/${esc(z.id)}" style="text-decoration:none;color:inherit">
          <div class="grow"><b>${esc(z.name)}</b></div><span class="pill">${esc(fmtIso(z.date))}</span>
        </a>`).join('')}</div>` : '<div class="card muted">אין זומים השבוע</div>'}

      <div class="section-title">עסק</div>
      ${d.finError ? `<div class="notice">${esc(d.finError)}</div>` : `
      <div class="tiles">
        <div class="card tile ${F.toReview ? 'alert' : ''}"><div class="num">${F.toReview}</div><div class="lbl">תנועות "לבדיקה" בפיננסים</div></div>
        <div class="card tile ${F.coachesLow.length ? 'alert' : ''}"><div class="num">${F.coachesLow.length}</div><div class="lbl">מאמנים עם ≤2 פגישות</div></div>
        <div class="card tile"><div class="num" style="font-size:18px">${esc(F.lastFinUpdate || '—')}</div><div class="lbl">עדכון פיננסים אחרון</div></div>
        <div class="card tile"><div class="num" style="font-size:18px">שלב 2</div><div class="lbl">ביטולים מאוחרים</div></div>
      </div>
      ${F.coachesLow.length ? `<div class="card" style="margin-top:10px">${F.coachesLow.map((c) => `
        <div class="row" style="padding:6px 0"><span class="grow">${esc(c.name)}</span><span class="pill ${c.left <= 1 ? 'danger' : 'warn'}">נותרו ${c.left} מתוך ${esc(c.package)}</span></div>`).join('')}</div>` : ''}`}
    `);
    $app.querySelectorAll('[data-filter]').forEach((a) => {
      a.addEventListener('click', () => { state.filter = a.dataset.filter; LS.set('lf_filter', state.filter); });
    });
  }

  // ---------- נתב ----------
  function route() {
    if (!state.session) return renderLogin();
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const page = parts[0];
    if (page === 'home' && isAdmin()) return viewHome();
    if (page === 'leads') return viewLeads();
    if (page === 'lead' && parts[1]) return viewLead(decodeURIComponent(parts[1]));
    if (page === 'untreated') return viewUntreated();
    if (page === 'ghosting') return viewGhosting();
    if (page === 'month') return viewMonth();
    if (page === 'zooms') return viewZooms();
    location.replace(isAdmin() ? '#/home' : '#/leads');
  }

  async function boot() {
    if (!state.session) return renderLogin();
    try {
      const me = await api('me');
      state.role = me.role; state.email = me.email; state.bookingUrl = me.bookingUrl;
      LS.set('lf_role', me.role);
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'FORBIDDEN') return renderLogin(e.code === 'FORBIDDEN' ? e.message : '');
      return errorView('Liel Fitness', e);
    }
    window.onhashchange = route;
    route();
    refreshAlerts();
    // רענון ברקע כשחוזרים לאפליקציה
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.session) { state.leads = null; refreshAlerts(); }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  boot();
})();
