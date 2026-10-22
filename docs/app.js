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
    realRole: LS.get('lf_role') || '',
    viewAs: LS.get('lf_viewas') || '',   // 'leads' = אדמין צופה כמו שי
    bookingUrl: '',
    leads: null,          // מטמון רשימת הלידים
    meta: null,           // statuses, zoomResults, hasUpdatedCol
    alertsCount: 0,
    filter: LS.get('lf_filter') || 'active',
    search: '',
    month: null,
    undoCount: 0,
  };

  const $app = document.getElementById('app');

  // ---------- זיכרון מקומי (לפי משתמש ותצוגה). נמחק ביציאה. ----------
  const store = {
    key(name) { return 'lf_c:' + (state.email || '') + ':' + (state.viewAs || '') + ':' + name; },
    get(name) { try { const v = LS.get(this.key(name)); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(name, data) { try { LS.set(this.key(name), JSON.stringify(data)); } catch (e) { /* מקום */ } },
    clearAll() {
      try { Object.keys(localStorage).filter((k) => k.indexOf('lf_c:') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* */ }
    },
  };

  // ---------- מדידת זמנים (מוצג רק עם ?debug=1) ----------
  if (/[?&]debug=1/.test(location.search)) LS.set('lf_debug', '1');
  if (/[?&]debug=0/.test(location.search)) LS.del('lf_debug');
  const timings = [];
  function logTiming(action, total, server, phases) {
    timings.unshift(`${action}: ${(total / 1000).toFixed(2)} שנ׳` + (server != null ? ` (שרת ${(server / 1000).toFixed(2)})` : '') +
      (phases ? ' [' + phases.join(' · ') + ']' : ''));
    timings.length = Math.min(timings.length, 8);
    if (LS.get('lf_debug') !== '1') return;
    let el = document.getElementById('dbg');
    if (!el) { el = document.createElement('div'); el.id = 'dbg'; document.body.appendChild(el); }
    el.innerHTML = timings.map(esc).join('<br>');
  }
  let navSeq = 0;   // מתחלף בכל מעבר מסך – כדי שתשובה מאוחרת לא תצייר מסך ישן
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
  function statusPill(s, key) {
    if (!s) return '<span class="pill warn">ללא סטטוס</span>';
    const raw = s; s = key || s;
    let cls = '';
    if (s === 'Ghosting') cls = 'ghost';
    else if (s === 'נסגר') cls = 'hot';
    else if (FINAL.includes(s)) cls = 'final';
    else if (s === 'זום נקבע') cls = 'hot';
    else if (s === 'ליד חדש') cls = 'warn';
    else if (s === 'פגישה בוטלה') cls = 'cancel';
    return `<span class="pill ${cls}">${esc(raw)}</span>`;
  }
  function isAdmin() { return state.role === 'admin'; }
  /** הסטטוס המנורמל מהשרת (בלי רווחים מיותרים / כתיב שונה) */
  function sk(l) { return l.statusKey != null ? l.statusKey : String(l.status || '').trim(); }

  // ---------- API ----------
  async function api(action, params) {
    if (!CFG.apiUrl) throw new Error('האתר עוד לא מחובר לשרת (חסר apiUrl ב-config.js)');
    const body = Object.assign({ action, session: state.session }, params || {});
    if (state.viewAs && action !== 'login') body.viewAs = state.viewAs;
    if (LS.get('lf_debug') === '1') body.debug = true;
    let res;
    const t0 = performance.now();
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
    logTiming(action, performance.now() - t0, out.ms, out.data && out.data.phases);
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
    store.clearAll(); undoStack = null;
    state.viewAs = ''; state.realRole = '';
    ['lf_session', 'lf_role', 'lf_email', 'lf_viewas'].forEach(LS.del);
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (e) { /* */ }
    if (!silent) location.hash = '';
    renderLogin();
  }

  function renderLogin(msg) {
    $app.innerHTML = `
      <div class="login">
        <div class="logo-mark">LF</div>
        <h1>צוות ליאל פיטנס</h1>
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
    $app.innerHTML = '<div class="splash"><div class="logo-mark">LF</div><div class="splash-title">צוות ליאל פיטנס</div></div>';
    try {
      const out = await api('login', { idToken: resp.credential });
      state.session = out.session; state.role = out.role; state.email = out.email;
      LS.set('lf_session', out.session); LS.set('lf_role', out.role); LS.set('lf_email', out.email);
      // התשובה של הכניסה כבר אומרת מי המשתמש – אין צורך לחכות לקריאה נוספת
      if (!store.get('me')) store.set('me', { email: out.email, role: out.role, realRole: out.role, bookingUrl: '' });
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
        ${state.realRole === 'admin' && !state.viewAs ? `<button class="icon-btn" data-act="viewas-on" title="תצוגה כמו שי" style="font-size:14px">👁 כמו שי</button>` : ''}
        <button class="icon-btn undo-btn" data-act="undo" aria-label="בטל פעולה אחרונה" title="בטל (פעולה אחרונה)" ${state.undoCount ? '' : 'disabled'}>↶</button>
        <button class="icon-btn" data-act="refresh" aria-label="רענון" title="רענון">🔄</button>
        <button class="icon-btn" data-act="logout" aria-label="יציאה" title="יציאה (${esc(state.email)})" style="font-size:14px">יציאה</button>
      </header>
      ${state.viewAs ? `<div class="viewas-bar"><span>👁 תצוגה כמו שי – כך היא רואה את האפליקציה. שמירות נכתבות באמת לגיליון.</span><button class="btn small secondary" data-act="viewas-off">חזרה לתצוגה שלי</button></div>` : ''}
      <main>${content}</main>
      <nav class="bottomnav">${nav.map(link).join('')}</nav>`;
    $app.querySelector('[data-act="refresh"]').onclick = () => { leadsFetchedAt = 0; state.forceFresh = true; route(); refreshAlerts(); };
    $app.querySelector('[data-act="logout"]').onclick = () => { if (confirm('לצאת מהאפליקציה?')) logout(); };
    $app.querySelector('[data-act="undo"]').onclick = undoLast;
    const vOn = $app.querySelector('[data-act="viewas-on"]');
    if (vOn) vOn.onclick = () => setViewAs('leads');
    const vOff = $app.querySelector('[data-act="viewas-off"]');
    if (vOff) vOff.onclick = () => setViewAs('');
    const back = $app.querySelector('[data-act="back"]');
    if (back) back.onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/leads'));
  }

  async function setViewAs(v) {
    state.viewAs = v;
    if (v) LS.set('lf_viewas', v); else LS.del('lf_viewas');
    state.leads = null; state.month = null; state.alertsCount = 0; leadsFetchedAt = 0; undoStack = null;
    $app.innerHTML = '<div class="splash"><div class="logo-mark">LF</div><div class="splash-title">צוות ליאל פיטנס</div></div>';
    location.hash = '';
    await boot();
  }

  function loading(title) { shell(title, '<div class="spinner"></div>'); }
  function errorView(title, e) {
    shell(title, `<div class="notice">${esc(e.message || e)}</div><button class="btn secondary" onclick="location.reload()">נסו שוב</button>`);
  }

  function applyLeadsData(d) {
    state.leads = d.leads;
    state.meta = { statuses: d.statuses, zoomResults: d.zoomResults, hasUpdatedCol: d.hasUpdatedCol, sources: d.sources, waitingFilter: !!d.waitingFilter };
  }
  function persistLeads() {
    if (!state.leads || !state.meta) return;
    store.set('leads', Object.assign({ leads: state.leads }, state.meta));
  }

  let leadsFetch = null, leadsFetchedAt = 0;
  /** מביא רשימה עדכנית מהשרת (לא יותר מפעם ב-10 שניות, אלא אם force). מחזיר true אם משהו השתנה. */
  function refreshLeads(force) {
    if (leadsFetch) return leadsFetch;
    if (!force && state.leads && Date.now() - leadsFetchedAt < 10000) return Promise.resolve(false);
    const fresh = !!state.forceFresh; state.forceFresh = false;
    leadsFetch = api('listLeads', fresh ? { fresh: true } : {}).then((d) => {
      leadsFetchedAt = Date.now();
      // לידים עם שמירה שעוד בדרך – נשארים בגרסה המקומית
      const local = {};
      (state.leads || []).forEach((l) => { if (pendingByLead[l.id]) local[l.id] = l; });
      d.leads = d.leads.map((l) => local[l.id] || l);
      const before = JSON.stringify(state.leads);
      applyLeadsData(d);
      persistLeads();
      return before !== JSON.stringify(state.leads);
    }).finally(() => { leadsFetch = null; });
    return leadsFetch;
  }

  /** מחזיר את הלידים מיד (מהזיכרון) אם יש; אחרת מחכה לשרת. */
  async function ensureLeads(force) {
    if (!state.leads) { const c = store.get('leads'); if (c) applyLeadsData(c); }
    if (state.leads && !force) return state.leads;
    await refreshLeads(true);
    return state.leads;
  }

  /** רענון ברקע: אם הגיעו נתונים חדשים ועדיין באותו מסך – onChange(). */
  function revalidateLeads(onChange) {
    const seq = navSeq;
    refreshLeads(false).then((changed) => { if (changed && seq === navSeq) onChange(); })
      .catch((e) => { if (seq === navSeq && e.code !== 'AUTH') toast('לא הצלחתי לרענן: ' + e.message, true); });
  }

  /** מסכים שלא מבוססים על רשימת הלידים: מציג מהזיכרון מיד ומרענן ברקע. */
  async function swr(name, action, params, title, render) {
    const seq = navSeq;
    const cached = store.get(name);
    if (cached) render(cached); else loading(title);
    try {
      const p = Object.assign({}, params || {});
      if (state.forceFresh) { p.fresh = true; state.forceFresh = false; }
      const fresh = await api(action, p);
      store.set(name, fresh);
      if (seq !== navSeq) return;
      if (!cached || JSON.stringify(cached) !== JSON.stringify(fresh)) {
        if (cached && isEditing()) return;   // לא מציירים מחדש באמצע הקלדה
        render(fresh);
      }
    } catch (e) {
      if (seq !== navSeq || e.code === 'AUTH') return;
      if (!cached) errorView(title, e); else toast('לא הצלחתי לרענן: ' + e.message, true);
    }
  }

  function isEditing() {
    const a = document.activeElement;
    return !!document.querySelector('.sheet-backdrop') ||
      !!(a && a !== document.body && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  async function refreshAlerts() {
    try {
      const d = await api('zoomAlerts');
      const n = d.alerts.length;
      if (n !== state.alertsCount) { state.alertsCount = n; if (!isEditing() && !cardBusy()) route(); }
    } catch (e) { /* לא קריטי */ }
  }

  // ---------- מסך: לידים ----------
  const FILTERS = [
    { k: 'active', t: 'פעילים', f: () => true },   // כל הלידים, בכל סטטוס
  ];
  // כפתור הסינון "נסגר" נספר לפי תוצאת הזום (P), לא לפי הסטטוס (N)
  function matchesFilter(l, f) {
    if (!f || f === 'active' || f === 'all') return true;
    if (f === 'waiting') return String(l.zoomResult || '').trim() === 'ממתין';
    if (!f.startsWith('s:')) return true;
    const st = f.slice(2);
    if (st === 'נסגר') return String(l.zoomResult || '').trim() === 'נסגר';
    return sk(l) === st;
  }

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
          <div class="top"><div class="name">${esc(l.name || '(ללא שם)')}</div>${statusPill(l.status, sk(l))}</div>
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
        <td>${statusPill(l.status, sk(l))}</td>
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
    if (!state.leads && !store.get('leads')) loading('לידים');
    try { await ensureLeads(); } catch (e) { return errorView('לידים', e); }
    renderLeadsView();
    revalidateLeads(() => {
      if (isEditing()) {   // באמצע הקלדה: רק מעדכנים שורות קיימות
        state.leads.forEach((l) => { if (rowEl(l.id)) patchRow(l.id, l); });
      } else {
        const y = window.scrollY; renderLeadsView(); window.scrollTo(0, y);
      }
    });
  }

  function renderLeadsView() {
    const statuses = state.meta.statuses;
    if (state.filter === 'all') state.filter = 'active';
    const counts = {};
    statuses.forEach((st) => { counts[st] = state.leads.filter((l) => matchesFilter(l, 's:' + st)).length; });
    if (state.filter === 'waiting' && !state.meta.waitingFilter) state.filter = 'active';
    const waitingN = state.leads.filter((l) => matchesFilter(l, 'waiting')).length;
    const chips = FILTERS.map((f) => ({ k: f.k, t: f.t, n: state.leads.filter(f.f).length }))
      .concat(state.meta.waitingFilter ? [{ k: 'waiting', t: 'ממתינים', n: waitingN }] : [])
      .concat(statuses.filter((st) => counts[st]).map((st) => ({ k: 's:' + st, t: st, n: counts[st] })));

    shell('לידים', `
      <div class="row search-row">
        <input class="search grow" type="search" placeholder="חיפוש לפי שם, טלפון או מייל" value="${esc(state.search)}" id="q" autocomplete="off">
        <button class="btn add-lead" data-act="add-lead">＋ ליד</button>
      </div>
      <div class="chips">${chips.map((c) => `<button class="chip ${state.filter === c.k ? 'on' : ''}" data-f="${esc(c.k)}">${esc(c.t)}<span class="n">${c.n}</span></button>`).join('')}</div>
      <div id="results"></div>`);

    const draw = () => {
      const f = state.filter;
      let list = state.leads.filter((l) => matchesFilter(l, f));
      list = list.filter((l) => matchSearch(l, state.search)).sort(sortNewest);
      document.getElementById('results').innerHTML = gridHtml(list);
    };
    bindGrid(document.getElementById('results'));
    draw();
    $app.querySelector('[data-act="add-lead"]').onclick = openAddLead;
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

  // ---------- רשימה עם עריכה ישירה (כמו שיטס) ----------
  function shortDate(s) {
    return String(s || '').replace(/(\d{1,2}[\/.]\d{1,2})[\/.]\d{2,4}/, '$1').trim();
  }
  function callText(l, n) {
    if (n === 1) return shortDate([l.call1Date, l.call1Time].filter(Boolean).join(' '));
    return shortDate(n === 2 ? l.call2 : l.call3);
  }
  function waText(l, n) { return shortDate(l['wa' + n]); }

  function attemptsHtml(l) {
    const cell = (kind, n, txt) => `
      <button type="button" class="att ${txt ? 'done' : ''} a-${kind}${n}" data-${kind}="${n}" title="${kind === 'call' ? 'ניסיון שיחה' : 'WA'} ${n}${txt ? ': ' + esc(txt) : ''}">
        <span class="att-k">${kind === 'call' ? '📞' : '💬'}${n}</span><span class="att-v">${txt ? esc(txt) : '+'}</span>
      </button>`;
    return [1, 2, 3].map((n) => cell('call', n, callText(l, n))).join('') +
      [1, 2, 3].map((n) => cell('wa', n, waText(l, n))).join('');
  }

  function statusSelect(l) {
    const key = sk(l);
    const list = state.meta.statuses.includes(key) || !key ? state.meta.statuses : [l.status].concat(state.meta.statuses);
    const cur = state.meta.statuses.includes(key) ? key : l.status;
    return `<select class="st-sel ${key === 'Ghosting' ? 'ghost' : key === 'פגישה בוטלה' ? 'cancel' : ''}" data-status aria-label="סטטוס">
      ${key ? '' : '<option value="" selected>— בחרי —</option>'}
      ${list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('')}
    </select>`;
  }

  function gridRowHtml(l) {
    return `
      <div class="g-row ${l.untreated ? 'untreated' : ''} ${l._pending ? 'pending' : ''}" data-id="${esc(l.id)}">
        <div class="g-entry">${esc(fmtIso(l.entry) || l.entryRaw)}</div>
        <div class="g-name"><a href="#/lead/${esc(l.id)}">${esc(l.name || '(ללא שם)')}</a></div>
        <div class="g-phone"><a class="ltr" href="${esc(telHref(l.phone))}">${esc(l.phone)}</a></div>
        <div class="g-status">${statusSelect(l)}</div>
        <div class="g-att">${attemptsHtml(l)}</div>
        <div class="g-notes g-shai"><label>הערות של שי</label><textarea rows="1" data-field="shaiNotes" placeholder="תזכורת קצרה…">${esc(l.shaiNotes)}</textarea></div>
        <div class="g-notes g-sum"><label>עיקרי שיחה</label><textarea rows="1" data-field="summary" placeholder="מה עלה בשיחה…">${esc(l.summary)}</textarea></div>
        <div class="g-zoom">${l.zoomDate ? '🎥 ' + esc(fmtIso(l.zoomDate)) : ''}</div>
        <div class="g-saved" aria-live="polite"></div>
      </div>`;
  }

  function gridHtml(list) {
    if (!list.length) return '<div class="empty">אין לידים להצגה</div>';
    return `
      <div class="grid">
        <div class="g-row g-head">
          <div class="g-entry">נכנס</div><div class="g-name">שם</div><div class="g-phone">טלפון</div><div class="g-status">סטטוס</div>
          <div class="g-att"><span>ניסיון 1</span><span>ניסיון 2</span><span>ניסיון 3</span><span>WA 1</span><span>WA 2</span><span>WA 3</span></div>
          <div class="g-notes g-shai">הערות של שי</div><div class="g-notes g-sum">עיקרי שיחה</div><div class="g-zoom">זום</div><div class="g-saved"></div>
        </div>
        ${list.map(gridRowHtml).join('')}
      </div>`;
  }

  // ---------- עדכון מיידי (אופטימי): המסך משתנה מיד, השמירה לגיליון ברקע ----------
  const pendingByLead = {};   // id → מספר שמירות שעוד בדרך
  const queueByLead = {};     // id → שרשרת שמירות (לפי הסדר, אחת אחרי השנייה)
  const seqByLead = {};

  function p2(n) { return String(n).padStart(2, '0'); }
  function todayText() { const d = new Date(); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; }
  function whenParts(when) {   // "2026-10-21T14:30"
    const m = String(when).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? { date: `${m[3]}/${m[2]}/${m[1]}`, short: `${m[3]}/${m[2]} ${m[4]}:${m[5]}`, time: `${m[4]}:${m[5]}` } : null;
  }
  function recount(l) {
    l.calls = [l.call1Date, l.call2, l.call3].filter((x) => String(x || '').trim()).length;
    l.was = [l.wa1, l.wa2, l.wa3].filter((x) => String(x || '').trim()).length;
    l.updatedAt = Date.now(); l.lastActivity = Date.now();
    l.untreated = false;
    return l;
  }

  /** מה משתנה בליד מיד על המסך, לפי הפעולה (כמו שהשרת יכתוב לגיליון). */
  function applyLocal(lead, action, params) {
    const l = Object.assign({}, lead);
    if (action === 'updateLead') {
      Object.keys(params.fields).forEach((k) => { l[k] = params.fields[k]; });
      if (params.fields.status != null) l.statusKey = params.fields.status;
    } else if (params.kind === 'wa') {
      const n = params.attempt || ([1, 2, 3].find((i) => !String(l['wa' + i] || '').trim()));
      if (n) l['wa' + n] = params.clear ? '' : todayText();
    } else if (params.kind === 'call') {
      const n = params.attempt, w = params.clear ? null : whenParts(params.when);
      if (n === 1) {
        l.call1Date = w ? w.date : ''; l.call1Time = w ? w.time : '';
        if (w && String(params.result || '').trim()) l.callResult = String(params.result).trim();
      } else {
        l['call' + n] = w ? w.short : '';
      }
    }
    return recount(l);
  }

  function setLead(lead) {
    const i = state.leads ? state.leads.findIndex((x) => x.id === lead.id) : -1;
    if (i >= 0 && !('zoomEvent' in lead) && state.leads[i].zoomEvent && state.leads[i].zoomDate === lead.zoomDate) {
      lead = Object.assign({}, lead, { zoomEvent: state.leads[i].zoomEvent });
    }
    if (i >= 0) state.leads[i] = lead;
    persistLeads();
  }

  /**
   * שמירה אופטימית: מעדכן מיד, שולח ברקע (לפי הסדר לכל ליד), ובכישלון – מחזיר למצב הקודם ומודיע.
   * hooks.onChange(lead) – לצייר מחדש; hooks.okMsg – הודעת הצלחה.
   */
  function optimistic(lead, action, params, hooks) {
    hooks = hooks || {};
    const before = lead;
    const local = applyLocal(lead, action, params);
    setLead(local);
    hooks.onChange && hooks.onChange(local, 'local');
    const id = lead.id;
    const seq = (seqByLead[id] = (seqByLead[id] || 0) + 1);
    pendingByLead[id] = (pendingByLead[id] || 0) + 1;
    const undoEntry = { leadId: id, before: before };
    pushUndoLocal(undoEntry);
    state.undoCount++; updateUndoBtn();
    const run = () => api(action, Object.assign({ row: lead.row, id: id }, params));
    const p = (queueByLead[id] || Promise.resolve()).catch(() => {}).then(run);
    queueByLead[id] = p;
    p.then((d) => {
      markDerivedStale();
      if (d.undoCount != null) { state.undoCount = d.undoCount; updateUndoBtn(); }
      if (seq === seqByLead[id] && d.lead) { setLead(d.lead); hooks.onChange && hooks.onChange(d.lead, 'server'); }
      hooks.onOk && hooks.onOk(d);
      if (d.ghost) toast(d.ghost.copied ? 'הועתק ללשונית הגוסטינג ✓' : d.ghost.reason, !d.ghost.copied && !/כבר קיים/.test(d.ghost.reason));
      if (d.reward && d.reward.warning) toast('⚠️ ' + d.reward.warning, true);
    }).catch((e) => {
      if (e.code === 'AUTH') return;
      state.undoCount = Math.max(0, state.undoCount - 1); updateUndoBtn();
      dropUndoLocal(undoEntry);
      if (seq === seqByLead[id]) { setLead(before); hooks.onChange && hooks.onChange(before, 'revert'); }
      hooks.onFail && hooks.onFail(e);
      toast('השינוי לא נשמר בגיליון והוחזר למצב הקודם: ' + e.message, true);
    }).finally(() => {
      pendingByLead[id]--;
      if (!pendingByLead[id]) { delete pendingByLead[id]; }
    });
    return p;
  }

  // ---------- בטל (↶) ----------
  // מחסנית מקומית: מצב הליד לפני כל פעולה – כדי שהביטול יופיע במסך מיד
  let undoStack = null;
  function getUndoStack() { if (!undoStack) undoStack = store.get('undo') || []; return undoStack; }
  function saveUndoStack() { store.set('undo', getUndoStack().slice(-15)); }
  function pushUndoLocal(entry) { const st = getUndoStack(); st.push(entry); while (st.length > 15) st.shift(); saveUndoStack(); }
  function dropUndoLocal(entry) { const st = getUndoStack(); const i = st.indexOf(entry); if (i >= 0) { st.splice(i, 1); saveUndoStack(); } }

  function showLead(lead) {
    if (rowEl(lead.id)) patchRow(lead.id, lead);
    else if (onLeadCard(lead.id)) { if (!cardBusy()) renderLead(lead); }
    else if (!isEditing()) route();
  }

  function updateUndoBtn() {
    const b = $app.querySelector('[data-act="undo"]');
    if (b) b.disabled = !state.undoCount;
  }
  let undoChain = Promise.resolve();
  function undoLast() {
    if (!state.undoCount) return;
    // מיידי: מחזירים את הליד במסך למצב שלפני הפעולה
    const entry = getUndoStack().pop() || null;
    saveUndoStack();
    let current = null, reinserted = false;
    if (entry && entry.kind === 'delete' && state.leads && !state.leads.find((l) => l.id === entry.leadId)) {
      state.leads.splice(Math.max(0, entry.at || 0), 0, entry.before); persistLeads(); reinserted = true;
      if (location.hash === '#/leads' && !isEditing()) renderLeadsView();
    } else if (entry && state.leads) {
      current = state.leads.find((l) => l.id === entry.leadId) || null;
      if (current) { setLead(entry.before); showLead(entry.before); }
    }
    state.undoCount = Math.max(0, state.undoCount - 1); updateUndoBtn();
    toast(entry ? '↶ בוטל' : 'מבטל…');
    // ברקע: הביטול בגיליון (לפי הסדר, אחרי שכל השמירות שבדרך הסתיימו)
    undoChain = undoChain.then(async () => {
      await Promise.allSettled(Object.values(queueByLead));
      try {
        const d = await api('undo');
        if (d.undoCount != null) state.undoCount = d.undoCount;
        if (d.done) {
          if (d.lead) { setLead(d.lead); showLead(d.lead); }
          toast(d.message + (d.warning ? ' · ⚠️ ' + d.warning : ''), !!d.warning);
        } else {
          // הגיליון לא אישר (למשל מישהו שינה מאז) → המסך חוזר למה שהיה
          if (current) { setLead(current); showLead(current); }
          if (reinserted) { state.leads = state.leads.filter((l) => l.id !== entry.leadId); persistLeads(); if (location.hash === '#/leads') renderLeadsView(); }
          toast(d.message, true);
          leadsFetchedAt = 0; refreshLeads(true).then((ch) => { if (ch && !isEditing() && !cardBusy()) route(); }).catch(() => {});
        }
      } catch (e) {
        if (current) { setLead(current); showLead(current); }
        if (e.code !== 'AUTH') toast('הביטול נכשל, המסך הוחזר: ' + e.message, true);
        api('undoCount').then((c) => { state.undoCount = c.undoCount; updateUndoBtn(); }).catch(() => {});
      }
      updateUndoBtn();
    });
  }

  function rowEl(id) { return $app.querySelector(`.g-row[data-id="${CSS.escape(id)}"]`); }

  function markRow(id, kind, msg) {
    const el = rowEl(id);
    if (!el) return;
    const s = el.querySelector('.g-saved');
    s.className = 'g-saved ' + kind;
    s.textContent = msg;
    clearTimeout(s._t);
    if (kind === 'ok') s._t = setTimeout(() => { s.textContent = ''; s.className = 'g-saved'; }, 2500);
  }

  /** מעדכן שורה במקום, בלי לפגוע בשדה שהמשתמשת מקלידה בו כרגע. */
  function patchRow(oldId, lead) {
    const el = rowEl(oldId);
    if (!el || !lead) return;
    el.dataset.id = lead.id;
    el.classList.toggle('untreated', !!lead.untreated);
    el.querySelector('.g-att').innerHTML = attemptsHtml(lead);
    el.querySelector('.g-status').innerHTML = statusSelect(lead);
    el.querySelector('.g-zoom').textContent = lead.zoomDate ? '🎥 ' + fmtIso(lead.zoomDate) : '';
    el.querySelectorAll('textarea[data-field]').forEach((t) => {
      if (document.activeElement !== t) t.value = lead[t.dataset.field] || '';
    });
  }

  function rowSave(lead, action, params, okMsg) {
    return optimistic(lead, action, params, {
      onChange: (l, why) => { patchRow(l.id, l); if (why === 'local') markRow(l.id, 'busy', 'שומר…'); },
      onOk: () => markRow(lead.id, 'ok', okMsg || 'נשמר ✓'),
      onFail: () => markRow(lead.id, 'err', 'לא נשמר ✕'),
    });
  }

  function bindGrid(root) {
    const leadOf = (el) => {
      const row = el.closest('.g-row[data-id]');
      return row && state.leads.find((l) => l.id === row.dataset.id);
    };

    root.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-call],[data-wa]');
      if (!b) return;
      const lead = leadOf(b);
      if (!lead) return;
      if (b.dataset.call) return openCallDialog(lead, Number(b.dataset.call));
      const n = Number(b.dataset.wa);
      const cur = waText(lead, n);
      if (cur) {
        if (!confirm(`לבטל את WA ${n} (${cur})?`)) return;
        rowSave(lead, 'markAttempt', { kind: 'wa', attempt: n, clear: true }, 'בוטל ✓').catch(() => {});
      } else {
        rowSave(lead, 'markAttempt', { kind: 'wa', attempt: n }).catch(() => {});
      }
    });

    root.addEventListener('change', (ev) => {
      const sel = ev.target.closest('select[data-status]');
      if (!sel) return;
      const lead = leadOf(sel);
      if (!lead || !sel.value || sel.value === lead.status || sel.value === sk(lead)) return;
      if (sel.value === 'Ghosting' && !confirm(`לסמן את ${lead.name} כ-Ghosting? הליד יועתק גם ללשונית הגוסטינג.`)) {
        sel.value = lead.status;
        return;
      }
      rowSave(lead, 'updateLead', { fields: { status: sel.value } }).catch(() => { sel.value = lead.status; });
    });

    // הערות של שי / עיקרי שיחה: שורה אחת שמתרחבת בלחיצה, נשמר כשיוצאים מהשדה
    const grow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
    root.addEventListener('focusin', (ev) => {
      const t = ev.target.closest('textarea[data-field]');
      if (t) { t.classList.add('open'); grow(t); }
    });
    root.addEventListener('input', (ev) => {
      const t = ev.target.closest('textarea[data-field]');
      if (t) grow(t);
    });
    root.addEventListener('focusout', (ev) => {
      const t = ev.target.closest('textarea[data-field]');
      if (!t) return;
      t.classList.remove('open'); t.style.height = '';
      const lead = leadOf(t);
      if (!lead) return;
      const k = t.dataset.field, v = t.value.trim();
      if (v === String(lead[k] || '').trim()) return;
      rowSave(lead, 'updateLead', { fields: { [k]: v } }).catch(() => {});
    });
  }

  // ---------- חלון כללי מלמטה ----------
  function openSheet(html) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    return { el: wrap, close };
  }

  // ---------- הוספת ליד ידני ----------
  function isoToday() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }

  function openAddLead() {
    const sources = (state.meta && state.meta.sources) || [];
    const sh = openSheet(`
      <div class="row"><b class="grow">הוספת ליד</b><button class="icon-btn" data-x aria-label="סגירה">✕</button></div>
      <div class="field"><label for="al-name">שם *</label><input id="al-name" autocomplete="off"></div>
      <div class="field"><label for="al-phone">טלפון *</label><input id="al-phone" type="tel" inputmode="tel" class="ltr-input" autocomplete="off"></div>
      <div class="field"><label for="al-email">מייל</label><input id="al-email" type="email" inputmode="email" class="ltr-input" autocomplete="off"></div>
      <div class="field"><label for="al-source">מקור</label><input id="al-source" list="al-sources" placeholder="בחרו מהרשימה או כתבו" autocomplete="off">
        <datalist id="al-sources">${sources.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="notice small" id="al-warn" hidden></div>
      <button class="btn" data-save>הוספה</button>`);
    const $ = (id) => sh.el.querySelector(id);
    setTimeout(() => $('#al-name').focus(), 50);
    let confirmedDup = false;
    $('[data-save]').onclick = () => {
      const name = $('#al-name').value.trim(), phone = $('#al-phone').value.trim();
      const email = $('#al-email').value.trim(), source = $('#al-source').value.trim();
      const warn = $('#al-warn');
      if (!name) { warn.hidden = false; warn.textContent = 'חסר שם'; return; }
      if (phone.replace(/\D/g, '').length < 9) { warn.hidden = false; warn.textContent = 'מספר טלפון לא תקין'; return; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { warn.hidden = false; warn.textContent = 'כתובת מייל לא תקינה'; return; }
      // בדיקת כפילות מיידית מול הרשימה שבזיכרון
      const pk = (x) => String(x || '').replace(/\D/g, '').slice(-9);
      const dups = (state.leads || []).filter((l) => pk(l.phone) && pk(l.phone) === pk(phone));
      if (dups.length && !confirmedDup) {
        warn.hidden = false;
        warn.innerHTML = `⚠️ הטלפון כבר קיים אצל: ${dups.map((d) => `<b>${esc(d.name)}</b> (${esc(fmtIso(d.entry) || d.entryRaw)}, ${esc(d.status || 'ללא סטטוס')})`).join(', ')}.<br>ללחוץ שוב על "הוספה" כדי להוסיף בכל זאת.`;
        confirmedDup = true;
        return;
      }
      sh.close();
      addLeadOptimistic({ name, phone, email, source }, confirmedDup);
    };
  }

  function addLeadOptimistic(f, force) {
    const tmpId = 'tmp-' + Date.now();
    const who = (CFG.senderNames || {})[state.realRole] || '';
    const temp = {
      id: tmpId, row: 0, _pending: true, entry: isoToday(), entryRaw: todayText(), name: f.name, phone: f.phone, email: f.email,
      ad: 'ידני – ' + who, source: f.source, status: 'ליד חדש', statusKey: 'ליד חדש', calls: 0, was: 0,
      updatedAt: Date.now(), lastActivity: Date.now(), untreated: false,
    };
    state.leads = [temp].concat(state.leads || []);
    persistLeads();
    if (location.hash === '#/leads') { const y = window.scrollY; renderLeadsView(); window.scrollTo(0, y); }
    toast('נוסף ✓ (נשמר לגיליון ברקע)');
    api('addLead', Object.assign({}, f, { force: !!force })).then((d) => {
      if (d.duplicate) {
        // השרת מצא כפילות שלא הייתה ברשימה שבזיכרון
        state.leads = state.leads.filter((l) => l.id !== tmpId); persistLeads();
        if (location.hash === '#/leads') renderLeadsView();
        if (confirm(`הטלפון כבר קיים אצל: ${d.duplicate.map((x) => x.name).join(', ')}. להוסיף בכל זאת?`)) addLeadOptimistic(f, true);
        return;
      }
      const i = state.leads.findIndex((l) => l.id === tmpId);
      if (i >= 0 && d.lead) state.leads[i] = d.lead; else if (d.lead) state.leads.unshift(d.lead);
      persistLeads();
      if (location.hash === '#/leads' && !isEditing()) { const y = window.scrollY; renderLeadsView(); window.scrollTo(0, y); }
      markDerivedStale();
    }).catch((e) => {
      state.leads = state.leads.filter((l) => l.id !== tmpId); persistLeads();
      if (location.hash === '#/leads') renderLeadsView();
      if (e.code !== 'AUTH') toast('הליד לא נוסף לגיליון: ' + e.message, true);
    });
  }

  // ---------- קביעת זום: פרטי הליד להעתקה, ואז היומן ----------
  function copyText(t, btn) {
    const done = () => { if (btn) { const o = btn.textContent; btn.textContent = 'הועתק ✓'; setTimeout(() => { btn.textContent = o; }, 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* */ } ta.remove();
    }
  }

  // מחיקת ליד (ליאל): מהמסך מיד, בגיליון ברקע (עם העתקה ל"לידים שנמחקו"); ↶ מחזיר
  function deleteLead(lead) {
    const ze = lead.zoomEvent && lead.zoomEvent.start > Date.now() ? lead.zoomEvent : null;
    let msg = `למחוק את ${lead.name}?\nזה ימחק את השורה מהגיליון (עותק נשמר בלשונית "לידים שנמחקו", ו-↶ מחזיר).`;
    if (ze) msg = `⚠️ ל${lead.name} יש זום ביומן ב-${fmtTs(ze.start)} – הפגישה לא תבוטל אוטומטית.\n\n` + msg;
    if (!confirm(msg)) return;
    const idx = state.leads.findIndex((l) => l.id === lead.id);
    state.leads = state.leads.filter((l) => l.id !== lead.id); persistLeads();
    const entry = { kind: 'delete', leadId: lead.id, before: lead, at: idx };
    pushUndoLocal(entry);
    state.undoCount++;
    location.hash = '#/leads';
    toast('נמחק ✓ (↶ מחזיר)');
    api('deleteLead', { row: lead.row, id: lead.id, name: lead.name, phone: lead.phone, force: true }).then((d) => {
      if (d.undoCount != null) { state.undoCount = d.undoCount; updateUndoBtn(); }
      leadsFetchedAt = 0; refreshLeads(true).catch(() => {}); markDerivedStale();
    }).catch((e) => {
      dropUndoLocal(entry); state.undoCount = Math.max(0, state.undoCount - 1);
      state.leads.splice(Math.max(0, idx), 0, lead); persistLeads();
      if (location.hash === '#/leads') renderLeadsView();
      if (e.code !== 'AUTH') toast('הליד לא נמחק: ' + e.message, true);
    });
  }

  // ---------- אישור זום בווטסאפ ----------
  const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  /** "מאמנת כושר | Daniell Blaish" → "Daniell". אפשר לתקן בחלון לפני השליחה. */
  function firstName(full) {
    const parts = String(full || '').split(/[|｜•·–—\-\/]+/).map((x) => x.trim()).filter(Boolean);
    const generic = /(מאמנ|מאמן|כושר|פילאטיס|סטודיו|fitness|coach|trainer|תזונה|אונליין)/i;
    const pick = parts.find((x) => !generic.test(x)) || parts[0] || '';
    const word = pick.replace(/[^\p{L}\p{M}\s'"׳״-]/gu, ' ').trim().split(/\s+/)[0] || '';
    return word;
  }
  /** שעת הפגישה (ms) → יום בשבוע, DD.MM, HH:mm – בשעון ישראל */
  function zoomParts(ms) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const p = {}; f.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
    const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { day: HEB_DAYS[dayIdx], date: `${p.day}.${p.month}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
  }
  function zoomConfirmText(name, ms) {
    const z = zoomParts(ms);
    return String(CFG.zoomConfirmTemplate || '').replace('{name}', name).replace('{day}', z.day).replace('{date}', z.date).replace('{time}', z.time);
  }
  function zoomConfirmButton(lead) {
    const ok = !!waNumber(lead.phone);
    return `<button class="btn green" data-act="wa-confirm" ${ok ? '' : 'disabled title="לליד אין מספר טלפון"'}>💬 שליחת אישור בווטסאפ</button>${ok ? '' : '<div class="muted small">לליד אין מספר טלפון בגיליון – אי אפשר לשלוח בווטסאפ</div>'}`;
  }
  function openZoomConfirm(lead) {
    const ze = lead.zoomEvent;
    const n = waNumber(lead.phone);
    if (!ze || !n) return;
    const sh = openSheet(`
      <div class="row"><b class="grow">אישור זום בווטסאפ – ${esc(lead.name)}</b><button class="icon-btn" data-x aria-label="סגירה">✕</button></div>
      <div class="field"><label for="wc-name">שם הליד בהודעה</label><input id="wc-name" value="${esc(firstName(lead.name))}"></div>
      <div class="wa-preview" id="wc-prev"></div>
      <a class="btn green" id="wc-send" target="_blank" rel="noopener">💬 פתיחה בווטסאפ</a>`);
    const inp = sh.el.querySelector('#wc-name'), prev = sh.el.querySelector('#wc-prev'), send = sh.el.querySelector('#wc-send');
    const draw = () => {
      const text = zoomConfirmText(inp.value.trim(), ze.start);
      prev.textContent = text;
      send.href = `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
    };
    inp.oninput = draw; draw();
    send.addEventListener('click', () => setTimeout(sh.close, 300));
  }

  // ביטול פגישה מהאפליקציה: מיידי במסך, המחיקה ביומן (וההודעה למוזמנים) ברקע
  function cancelZoom(lead) {
    const ze = lead.zoomEvent;
    if (!ze || !confirm(`לבטל את הזום של ${lead.name} ב-${fmtTs(ze.start)}?\nהפגישה תימחק מהיומן ויישלח ביטול למוזמנים.`)) return;
    const before = lead;
    const final = FINAL.includes(sk(lead));
    const local = Object.assign({}, lead, { zoomDate: '', zoomEvent: null, updatedAt: Date.now() },
      final ? {} : { status: 'פגישה בוטלה', statusKey: 'פגישה בוטלה' });
    setLead(local); showLead(local);
    toast('הפגישה בוטלה ✓ (נמחקת מהיומן ברקע)');
    api('cancelZoom', { row: lead.row, id: lead.id, eventId: ze.id }).then((d) => {
      if (d.lead) { setLead(d.lead); showLead(d.lead); }
      markDerivedStale();
    }).catch((e) => {
      setLead(before); showLead(before);
      if (e.code !== 'AUTH') toast('הביטול לא בוצע, הפגישה נשארה: ' + e.message, true);
    });
  }

  function openBookingHelper(lead, opts) {
    opts = opts || {};
    const items = [['שם', lead.name], ['מייל', lead.email], ['טלפון', lead.phone]].filter((x) => String(x[1] || '').trim());
    const embed = state.bookingEmbedUrl;
    const wrap = document.createElement('div');
    wrap.className = 'booking-overlay';
    wrap.innerHTML = `
      <div class="booking-top">
        <div class="row"><b class="grow">${opts.reschedule ? 'שינוי מועד' : 'קביעת זום'} – ${esc(lead.name)}</b><button class="btn small" data-close>סגור ✕</button></div>
        ${opts.reschedule ? '<div class="small booking-hint">🔁 בחרי מועד חדש. <b>הפגישה הישנה תימחק רק אחרי שהחדשה תיקבע</b> – אם לא תקבעי, שום דבר לא משתנה.</div>' : ''}
        <div class="small booking-hint">מלאי בדף את <b>פרטי הליד</b> (לא את שלך):</div>
        ${!String(lead.email || '').trim() || String(lead.email).trim() === '-' ? '<div class="notice small no-email">📧 לליד אין מייל – שאלי אותו ומלאי אותו בדף</div>' : ''}
        <div class="booking-copy">${items.map(([k, v], i) => `<button class="chip" data-copy="${i}" title="העתקה">${k}: <span class="ltr-text">${esc(v)}</span> ⧉</button>`).join('')}</div>
      </div>
      ${embed ? `<iframe class="booking-frame" src="${esc(embed)}" title="פגישת אפיון"></iframe>` : '<div class="empty">חסרה כתובת להטמעה</div>'}
      <div class="booking-foot small"><a href="${esc(state.bookingUrl)}" target="_blank" rel="noopener" data-ext>הדף לא נטען? פתחי בדפדפן</a></div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    // "קביעה ממתינה": אם בעשר הדקות הקרובות תיקבע פגישה בלי פרטים של ליד – היא תשויך לליד הזה
    if (lead.row) api('pendingBooking', { row: lead.row, id: lead.id, reschedule: !!opts.reschedule }).catch(() => {});
    wrap.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => copyText(String(items[Number(b.dataset.copy)][1]), b); });
    const close = () => {
      wrap.remove(); document.body.classList.remove('no-scroll');
      watchBooking(lead);
    };
    wrap.querySelector('[data-close]').onclick = close;
    wrap.querySelector('[data-ext]').addEventListener('click', () => { pendingBooking = { lead, at: Date.now() }; });
  }

  // ---------- אחרי קביעת זום: בדיקה אוטומטית אם הליד עודכן ----------
  let pendingBooking = null;   // נפתח דף ההזמנה מחוץ לאפליקציה – נבדוק כשחוזרים
  let bookingWatch = null;
  function watchBooking(lead) {
    if (bookingWatch) clearTimeout(bookingWatch.t);
    const before = (state.leads || []).find((l) => l.id === lead.id) || lead;
    const tries = [2000, 6000, 12000, 20000, 35000];   // ההזמנה מתעדכנת בגיליון תוך ~10 שניות
    let i = 0;
    toast('בודקת אם הזום נקבע…');
    const tick = () => {
      api('getLead', { row: before.row, id: before.id }).then((d) => {
        const l = d.lead;
        if (l && (l.zoomDate !== before.zoomDate || l.status !== before.status)) {
          setLead(l); showLead(l); markDerivedStale();
          if (l.zoomEvent && l.zoomEvent.start > Date.now()) {
            const sh = openSheet(`
              <div class="row"><b class="grow">✅ זום נקבע – ${esc(l.name)}</b><button class="icon-btn" data-x aria-label="סגירה">✕</button></div>
              <div>${esc(fmtTs(l.zoomEvent.start))}</div>
              ${zoomConfirmButton(l)}`);
            const b = sh.el.querySelector('[data-act="wa-confirm"]');
            if (b) b.onclick = () => { sh.close(); openZoomConfirm(l); };
          } else {
            toast(l.zoomDate ? `✅ זום נקבע ל-${fmtIso(l.zoomDate)}` : 'הליד עודכן');
          }
          bookingWatch = null;
          return;
        }
        if (++i < tries.length) bookingWatch = { t: setTimeout(tick, tries[i] - tries[i - 1]) };
        else { bookingWatch = null; toast('הזום עוד לא הופיע. אם קבעת – הוא יתעדכן בעוד רגע (או ב"זומים לשיוך").'); }
      }).catch(() => { bookingWatch = null; });
    };
    bookingWatch = { t: setTimeout(tick, tries[0]) };
  }

  // ---------- טעינה ברקע של כל המסכים ----------
  let derivedTimer = null;
  /** אחרי שינוי: הנתונים של "בית"/"החודש שלי" מתרעננים ברקע (לא מיד, כדי לא להעמיס) */
  function markDerivedStale() {
    clearTimeout(derivedTimer);
    derivedTimer = setTimeout(() => prefetchAll(true), 4000);
  }

  function monthKeyNow(delta) {
    const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth() + (delta || 0), 1);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1);
  }

  function prefetchOne(name, action, params) {
    return api(action, params || {}).then((d) => { store.set(name, d); }).catch(() => {});
  }

  /** טוען ברקע את הנתונים של כל המסכים, כדי שכל מעבר בין לשוניות יוצג מיד מהזיכרון. */
  function prefetchAll(onlyDerived) {
    const jobs = [];
    if (!onlyDerived) {
      jobs.push(refreshLeads(false).catch(() => {}));
      jobs.push(prefetchOne('ghosting', 'listGhosting'));
      jobs.push(prefetchOne('zooms', 'zoomAlerts'));
    }
    if (isAdmin()) jobs.push(prefetchOne('home', 'home'));
    jobs.push(prefetchOne('month:' + monthKeyNow(0), 'month', { month: monthKeyNow(0) }));
    if (!onlyDerived) jobs.push(prefetchOne('month:' + monthKeyNow(-1), 'month', { month: monthKeyNow(-1) }));
    return Promise.all(jobs);
  }

  // חלון קטן לניסיון שיחה (משמש גם ברשימה)
  function openCallDialog(lead, n) {
    const d = new Date(), p = (x) => String(x).padStart(2, '0');
    const now = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    const cur = callText(lead, n);
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="ניסיון שיחה ${n}">
        <div class="row"><b class="grow">ניסיון שיחה ${n} · ${esc(lead.name)}</b><button class="icon-btn" data-x aria-label="סגירה">✕</button></div>
        ${cur ? `<div class="notice small">כבר רשום: "${esc(cur)}" – שמירה תחליף אותו.</div>` : ''}
        <div class="field"><label for="dlg-when">תאריך ושעה</label><input id="dlg-when" type="datetime-local" value="${now}"></div>
        ${n === 1 ? `<div class="field"><label for="dlg-res">תוצאת שיחה</label><input id="dlg-res" value="${esc(lead.callResult)}" placeholder="למשל: לא זמינה / נקבעה פגישה"></div>` : ''}
        <div class="row">
          <button class="btn grow" data-save>שמירה</button>
          ${cur ? '<button class="btn danger" data-clear>ביטול הניסיון</button>' : ''}
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    wrap.querySelector('[data-save]').onclick = async (e) => {
      const when = wrap.querySelector('#dlg-when').value;
      if (!when) return toast('צריך לבחור תאריך ושעה', true);
      const res = wrap.querySelector('#dlg-res');
      e.currentTarget.disabled = true;
      close();
      rowSave(lead, 'markAttempt', { kind: 'call', attempt: n, when, result: res ? res.value : undefined, overwrite: !!cur }).catch(() => {});
    };
    const clr = wrap.querySelector('[data-clear]');
    if (clr) clr.onclick = () => {
      if (!confirm(`לבטל את ניסיון ${n}?`)) return;
      close();
      rowSave(lead, 'markAttempt', { kind: 'call', attempt: n, clear: true }, 'בוטל ✓').catch(() => {});
    };
  }

  // ---------- מסך: לא טופלו ----------
  async function viewUntreated() {
    if (!state.leads && !store.get('leads')) loading('לא טופלו');
    try { await ensureLeads(); } catch (e) { return errorView('לא טופלו', e); }
    renderUntreated();
    revalidateLeads(renderUntreated);
  }

  function renderUntreated() {
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
    if (!state.leads && !store.get('leads')) loading('כרטיס ליד');
    try { await ensureLeads(); } catch (e) { return errorView('כרטיס ליד', e); }
    let lead = state.leads.find((l) => l.id === id);
    if (!lead) {
      loading('כרטיס ליד');
      try { await ensureLeads(true); } catch (e) { return errorView('כרטיס ליד', e); }
      lead = state.leads.find((l) => l.id === id);
    }
    if (!lead) return shell('כרטיס ליד', '<div class="empty">הליד לא נמצא. אולי הפרטים שלו שונו בגיליון.</div>', { back: true });
    renderLead(lead);
    revalidateLeads(() => {
      const fresh = state.leads.find((l) => l.id === id);
      if (fresh && !cardBusy()) renderLead(fresh);
    });
  }

  let cardDirty = () => false;
  function cardBusy() {
    const panel = document.getElementById('callPanel');
    return cardDirty() || (panel && !panel.hidden) || isEditing();
  }
  function onLeadCard(id) { return location.hash === '#/lead/' + id; }

  function infoRow(label, val, ltr) {
    if (!val) return '';
    return `<dt>${esc(label)}</dt><dd>${ltr ? `<span class="ltr">${esc(val)}</span>` : esc(val)}</dd>`;
  }

  function renderLead(lead) {
    const m = state.meta;
    const tel = telHref(lead.phone), wa = waHref(lead);
    const opt = (list, cur) => ['<option value=""></option>'].concat((cur && !list.includes(cur) ? [cur] : []).concat(list)
      .map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`)).join('');
    const statusList = m.statuses.includes(sk(lead)) || !sk(lead) ? m.statuses : [lead.status].concat(m.statuses);

    shell(lead.name || 'כרטיס ליד', `
      <div class="lead-layout">
        <div>
          <div class="card">
            <div class="lead-head">
              <div class="grow">
                <h2>${esc(lead.name || '(ללא שם)')}</h2>
                <div class="muted small" style="margin-top:4px">נכנס ${esc(fmtIso(lead.entry) || lead.entryRaw)}${lead.updatedAt ? ' · עודכן ' + esc(fmtTs(lead.updatedAt)) : ''}</div>
              </div>
              ${statusPill(lead.status, sk(lead))}
            </div>
            <div class="quick">
              <a class="btn" ${tel ? `href="${esc(tel)}"` : 'disabled'}>📞 חיוג</a>
              <a class="btn green" ${wa ? `href="${esc(wa)}" target="_blank" rel="noopener"` : 'disabled'}>💬 ווטסאפ</a>
              <button class="btn secondary" data-act="call">✔︎ ניסיון שיחה <span class="counter">${lead.calls}/3</span></button>
              <button class="btn secondary" data-act="wa" ${lead.was >= 3 ? 'disabled' : ''}>✔︎ נשלח WA <span class="counter">${lead.was}/3</span></button>
            </div>
            <div id="callPanel" class="call-panel" hidden>
              <div class="field">
                <label>מספר ניסיון</label>
                <div class="seg">${[1, 2, 3].map((n) => `<button type="button" class="chip" data-n="${n}">ניסיון ${n}</button>`).join('')}</div>
              </div>
              <div class="field"><label for="c-when">תאריך ושעה</label><input id="c-when" type="datetime-local"></div>
              <div class="field" id="c-result-wrap"><label for="c-result">תוצאת שיחה (נכתב ל"ניסיון 1 שיחה")</label><input id="c-result" placeholder="למשל: לא זמינה / נקבעה פגישה"></div>
              <div class="notice small" id="c-warn" hidden></div>
              <div class="row">
                <button class="btn grow" data-act="call-save">שמירת ניסיון</button>
                <button class="btn ghost" data-act="call-cancel">ביטול</button>
              </div>
            </div>
            ${lead.zoomEvent && lead.zoomEvent.start > Date.now()
              ? `<div class="zoom-box"><div class="small">🎥 זום ב-${esc(fmtTs(lead.zoomEvent.start))}</div>
                   ${zoomConfirmButton(lead)}
                   <div class="row"><button class="btn secondary grow" data-act="resched">🔁 שינוי מועד</button><button class="btn danger grow" data-act="cancel-zoom">✕ ביטול פגישה</button></div></div>`
              : (state.bookingUrl ? `<button class="btn secondary" style="width:100%;margin-top:10px" data-act="book">🎥 קביעת זום (פגישת אפיון)</button>` : '')}
          </div>

          <div class="section-title">עדכון</div>
          <div class="card form" id="form">
            <div class="field">
              <label>סטטוס</label>
              <div class="status-grid">${statusList.map((s) => `<button type="button" class="chip ${s === sk(lead) ? 'on' : ''}" data-status"${esc(s)}">${esc(s)}</button>`).join('')}</div>
            </div>
            <div class="field"><label for="f-callResult">תוצאת שיחה</label><input id="f-callResult" value="${esc(lead.callResult)}" placeholder="למשל: לא ענה / ביקש לחזור מחר"></div>
            <div class="field"><label for="f-shaiNotes">הערות של שי</label><textarea id="f-shaiNotes" class="short" placeholder="למשל: להתקשר ביום ראשון / ביקשה הודעה בווטסאפ">${esc(lead.shaiNotes)}</textarea></div>
            <div class="field"><label for="f-summary">עיקרי שיחה</label><textarea id="f-summary" placeholder="מה עלה בשיחה עם הליד">${esc(lead.summary)}</textarea></div>
            <div class="row">
              <div class="field grow"><label for="f-zoomDate">תאריך זום</label><input id="f-zoomDate" type="date" value="${esc(lead.zoomDate)}"></div>
              <div class="field grow"><label for="f-zoomResult">תוצאת זום</label><select id="f-zoomResult">${opt(m.zoomResults, lead.zoomResult)}</select></div>
            </div>
            <div class="field"><label for="f-notes">פירוט תוצאת זום / סכום</label><input id="f-notes" value="${esc(lead.notes)}" placeholder="למשל: כלכלי / 9500"></div>
            ${lead.zoomDateRaw && !lead.zoomDate ? `<div class="notice small">בגיליון כתוב בתאריך הזום: "${esc(lead.zoomDateRaw)}" – לא הצלחתי לפענח.</div>` : ''}
          </div>
          <div class="savebar">
            <button class="btn" data-act="save" disabled>שמירה</button>
          </div>
        </div>

        <div>
          ${state.realRole === 'admin' && !state.viewAs ? '<button class="btn danger small" data-act="delete-lead" style="margin-top:14px">🗑 מחיקת ליד</button>' : ''}
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

    const bookBtn = $app.querySelector('[data-act="book"]');
    if (bookBtn) bookBtn.onclick = () => openBookingHelper(lead);
    const reBtn = $app.querySelector('[data-act="resched"]');
    if (reBtn) reBtn.onclick = () => openBookingHelper(lead, { reschedule: true });
    const cxBtn = $app.querySelector('[data-act="cancel-zoom"]');
    if (cxBtn) cxBtn.onclick = () => cancelZoom(lead);
    const wcBtn = $app.querySelector('[data-act="wa-confirm"]');
    if (wcBtn) wcBtn.onclick = () => openZoomConfirm(lead);
    const delBtn = $app.querySelector('[data-act="delete-lead"]');
    if (delBtn) delBtn.onclick = () => deleteLead(lead);

    // --- טופס ---
    let status = lead.status;
    const saveBtn = $app.querySelector('[data-act="save"]');
    const ids = ['callResult', 'shaiNotes', 'summary', 'notes', 'zoomDate', 'zoomResult'];
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
    cardDirty = () => Object.keys(collect()).length > 0;
    // אחרי שמירה ברקע: מציירים מחדש רק אם עדיין בכרטיס הזה ולא באמצע עריכה
    const redraw = (l) => { if (onLeadCard(l.id) && !cardBusy()) renderLead(l); };
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
      cardDirty = () => false;
      optimistic(lead, 'updateLead', { fields }, {
        onChange: (l, why) => { if (why === 'local') renderLead(l); else redraw(l); },
        onOk: (d) => { if (!d.ghost && !(d.reward && d.reward.warning)) toast('נשמר ✓'); },
      });
    };

    const guardDirty = () => !Object.keys(collect()).length || confirm('יש שינויים שלא נשמרו בטופס. להמשיך בלי לשמור אותם?');

    // --- ניסיון שיחה: בחירת מספר ניסיון + תאריך ושעה ---
    const panel = document.getElementById('callPanel');
    const slots = { 1: [lead.call1Date, lead.call1Time].filter(Boolean).join(' '), 2: lead.call2, 3: lead.call3 };
    let attempt = 1;
    const pickAttempt = (n) => {
      attempt = n;
      panel.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', Number(x.dataset.n) === n));
      document.getElementById('c-result-wrap').hidden = n !== 1;
      const warn = document.getElementById('c-warn');
      warn.hidden = !slots[n];
      warn.textContent = slots[n] ? `בניסיון ${n} כבר כתוב "${slots[n]}" – שמירה תחליף אותו.` : '';
    };
    panel.querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => pickAttempt(Number(b.dataset.n)); });
    $app.querySelector('[data-act="call"]').onclick = () => {
      if (!panel.hidden) { panel.hidden = true; return; }
      const d = new Date(), p = (x) => String(x).padStart(2, '0');
      document.getElementById('c-when').value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      document.getElementById('c-result').value = lead.callResult || '';
      const next = [1, 2, 3].find((n) => !slots[n]) || 3;
      pickAttempt(next);
      panel.hidden = false;
    };
    $app.querySelector('[data-act="call-cancel"]').onclick = () => { panel.hidden = true; };
    $app.querySelector('[data-act="call-save"]').onclick = async (ev) => {
      const b = ev.currentTarget;
      const when = document.getElementById('c-when').value;
      if (!when) return toast('צריך לבחור תאריך ושעה', true);
      if (!guardDirty()) return;
      panel.hidden = true; cardDirty = () => false;
      const n = attempt;
      optimistic(lead, 'markAttempt', {
        kind: 'call', attempt: n, when,
        result: n === 1 ? document.getElementById('c-result').value : undefined,
        overwrite: !!slots[n],
      }, {
        onChange: (l, why) => { if (why === 'local') renderLead(l); else redraw(l); },
        onOk: () => toast(`נשמר ניסיון ${n} ✓`),
      });
      void b;
    };

    // --- WA: העמודה הפנויה הבאה בתאריך היום ---
    const waBtn = $app.querySelector('[data-act="wa"]');
    waBtn.onclick = async () => {
      if (!guardDirty()) return;
      cardDirty = () => false;
      optimistic(lead, 'markAttempt', { kind: 'wa' }, {
        onChange: (l, why) => { if (why === 'local') renderLead(l); else redraw(l); },
        onOk: () => toast('סומן WA ✓'),
      });
    };
  }

  function replaceLead(oldId, lead) {
    if (!state.leads) return;
    const i = state.leads.findIndex((l) => l.id === oldId);
    if (lead && i >= 0) state.leads[i] = lead;
    else state.leads = null;
    if (lead && oldId !== lead.id) history.replaceState(null, '', '#/lead/' + lead.id);
  }

  // ---------- מסך: גוסטינג ----------
  function viewGhosting() {
    return swr('ghosting', 'listGhosting', {}, 'גוסטינג', renderGhosting);
  }

  function renderGhosting(d) {
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
    return swr('month:' + state.month, 'month', { month: state.month }, title, (d) => renderMonth(title, d));
  }

  function renderMonth(title, d) {
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
        <div class="card tile"><div class="num">${d.meetings.length}</div><div class="lbl">פגישות שנספרות${d.pending.length ? ` · עוד ${d.pending.length} ממתינות לתוצאה` : ''}</div></div>
        <div class="card tile"><div class="num">${ils(d.bonusTotal)}</div><div class="lbl">בונוס פגישות</div></div>
        <div class="card tile"><div class="num">${d.currentTier || '—'}</div><div class="lbl">מדרגה נוכחית</div></div>
      </div>
      ${d.locked ? `<div class="notice" style="margin-top:10px">🔒 חודש נעול (כבר שולם). הסכומים כאן לפי מה שרשום בגיליון (עמודה S), ושינויים בתאריך/תוצאת זום לא משנים אותם.</div>
        ${d.lockedDiffs.length ? `<div class="notice">⚠️ שונו אחרי הנעילה – לפי הכלל היה יוצא אחרת (S לא שונה):<br>${d.lockedDiffs.map((x) => `${esc(x.name)} · ${esc(fmtIso(x.date))}: בגיליון "${esc(x.sheet || 'ריק')}", לפי הכלל "${esc(x.rule || 'ריק')}"`).join('<br>')}</div>` : ''}` : `
      <div class="card" style="margin-top:10px">
        ${d.toNextTier
          ? `<b>עוד ${d.toNextTier} ${d.toNextTier === 1 ? 'פגישה' : 'פגישות'}</b> למדרגה הבאה (${ils(d.nextTierAmount)} לפגישה)`
          : '<b>את במדרגה העליונה 🚀</b> (120 ₪ לפגישה)'}
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="muted small" style="margin-top:8px">פגישות 1 עד 5: 80 ₪ · פגישות 6 עד 10: 100 ₪ · מ-11 ומעלה: 120 ₪<br>פגישה נספרת כשיש תאריך זום ותוצאת זום (נסגר / לא נסגר / ממתין), בחודש של תאריך הזום</div>
      </div>`}

      <div class="section-title">פירוט פגישות</div>
      ${d.meetings.length ? `<div class="mlist">${d.meetings.map((m) => `
        <a class="card mrow" href="#/lead/${esc(m.id)}" style="text-decoration:none;color:inherit">
          <div class="n">${m.n}</div>
          <div class="grow">
            <div><b>${esc(m.name)}</b></div>
            <div class="muted small">${esc(fmtIso(m.date))} · מדרגה ${m.tier} · ${esc(m.zoomResult)}</div>
            ${m.mismatch ? `<div class="small" style="color:var(--warn)">בגיליון (S): ${m.sheetReward ? `"${esc(m.sheetReward)}"` : 'ריק'}</div>` : ''}
          </div>
          <div class="amt">${ils(m.amount)}</div>
        </a>`).join('')}</div>` : '<div class="empty">עוד אין זומים בחודש הזה</div>'}
      ${d.pending.length ? `<div class="section-title">ממתינות לתוצאת זום – עוד לא נספרות (${d.pending.length})</div>
        <div class="mlist">${d.pending.map((x) => `<a class="card mrow" href="#/lead/${esc(x.id)}" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(x.name)}</b></div><span class="pill warn">${esc(fmtIso(x.date))}</span></a>`).join('')}</div>` : ''}
      ${d.noShow.length ? `<div class="section-title">לא הגיעו – בלי בונוס (${d.noShow.length})</div>
        <div class="card small">${d.noShow.map((x) => `${esc(x.name)} · ${esc(fmtIso(x.date))}`).join('<br>')}</div>` : ''}`);

    $app.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => { state.month = shiftMonth(state.month, Number(b.dataset.m)); viewMonth(); };
    });
  }

  // ---------- מסך: זומים לשיוך ----------
  function viewZooms() {
    ensureLeads().catch(() => {});
    return swr('zooms', 'zoomAlerts', {}, 'זומים לשיוך', renderZooms);
  }

  function renderZooms(d) {
    state.alertsCount = d.alerts.length;
    const leadsNow = state.leads || [];
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
            ${a.leadId ? `<button class="btn small" data-assign="${esc(a.leadId)}">שייך ל${esc((leadsNow.find((l) => l.id === a.leadId) || {}).name || 'ליד שנמצא')} (עדכון תאריך)</button>` : ''}
            <button class="btn ghost small" data-dismiss>התעלם</button>
          </div>
        </div>`).join('')}</div>` : '<div class="empty">אין זומים שמחכים לשיוך ✓</div>');

    $app.querySelectorAll('[data-key]').forEach((card) => {
      const key = card.dataset.key;
      // הסרה מיידית מהמסך; אם השרת נכשל – חוזר עם הודעה
      const removeLocal = () => {
        const before = store.get('zooms') || d;
        const after = { alerts: before.alerts.filter((x) => x.key !== key) };
        store.set('zooms', after); state.alertsCount = after.alerts.length;
        renderZooms(after);
        return before;
      };
      const assign = (leadId) => {
        const l = (state.leads || []).find((x) => x.id === leadId);
        if (!l || !confirm(`לשייך את הזום ל${l.name}?`)) return;
        const before = removeLocal();
        toast('שויך ✓');
        api('assignZoom', { key, row: l.row, id: l.id }).then((r) => {
          leadsFetchedAt = 0; refreshLeads(true).catch(() => {}); markDerivedStale();
          if (r && r.warning) toast('⚠️ ' + r.warning, true);
        }).catch((e) => { store.set('zooms', before); if (location.hash === '#/zooms') renderZooms(before); toast('השיוך לא נשמר: ' + e.message, true); });
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
      card.querySelector('[data-dismiss]').onclick = () => {
        if (!confirm('להתעלם מהזום הזה? הוא לא ישויך לאף ליד.')) return;
        const before = removeLocal();
        toast('הוסר');
        api('dismissZoom', { key }).catch((e) => { store.set('zooms', before); if (location.hash === '#/zooms') renderZooms(before); toast('לא הוסר: ' + e.message, true); });
      };
    });
  }

  // ---------- מסך: בית (ליאל) ----------
  function viewHome() {
    return swr('home', 'home', {}, 'תמונת מצב', renderHome);
  }

  function renderHome(d) {
    state.alertsCount = d.zoomAlerts;
    const L = d.leads, F = d.fin;
    shell('תמונת מצב', `
      <div class="section-title" style="margin-top:4px">לידים</div>
      <div class="tiles">
        <a class="card tile" href="#/leads" data-filter="s:ליד חדש"><div class="num">${L.newStatus}</div><div class="lbl">בסטטוס "ליד חדש"</div></a>
        <a class="card tile ${L.untreated ? 'alert' : ''}" href="#/untreated"><div class="num">${L.untreated}</div><div class="lbl">לא טופלו יומיים+</div></a>
      </div>

      <div class="section-title">ממתינים – לחזור אליהם אחרי פגישה (${(L.waiting || []).length})</div>
      ${(L.waiting || []).length ? `<div class="mlist">${L.waiting.map((w) => `
        <div class="card mrow waiting-row">
          <div class="grow">
            <a href="#/lead/${esc(w.id)}" class="waiting-name"><b>${esc(w.name)}</b></a>
            <div class="muted small">${w.date ? 'זום ' + esc(fmtIso(w.date)) : 'בלי תאריך זום'}${w.notes ? ' · ' + esc(w.notes) : ''}</div>
          </div>
          ${telHref(w.phone) ? `<a class="icon-btn round" href="${esc(telHref(w.phone))}" aria-label="חיוג">📞</a>` : ''}
          ${waNumber(w.phone) ? `<a class="icon-btn round" href="https://wa.me/${esc(waNumber(w.phone))}" target="_blank" rel="noopener" aria-label="ווטסאפ">💬</a>` : ''}
        </div>`).join('')}</div>` : '<div class="card muted">אין ממתינים כרגע</div>'}

      <div class="section-title">זומים ב-7 הימים הקרובים (${L.zoomsWeek.length})</div>
      ${L.zoomsWeek.length ? `<div class="mlist">${L.zoomsWeek.map((z) => `
        <a class="card mrow" href="#/lead/${esc(z.id)}" style="text-decoration:none;color:inherit">
          <div class="grow"><b>${esc(z.name)}</b></div><span class="pill">${esc(fmtIso(z.date))}</span>
        </a>`).join('')}</div>` : '<div class="card muted">אין זומים השבוע</div>'}

      ${d.zoomAuto ? `<div class="card small" style="margin-top:10px">
        <b>עדכון אוטומטי של זומים:</b> ${d.zoomAuto.trigger === 'ok' ? '⚡ מיידי (טריגר שינוי ביומן) + גיבוי כל 10 דק׳' : esc(d.zoomAuto.trigger)}
        ${d.zoomAuto.last ? `<br>אחרון: ${esc(d.zoomAuto.last.name)} – עודכן ${d.zoomAuto.last.seconds != null ? `תוך ${d.zoomAuto.last.seconds < 120 ? d.zoomAuto.last.seconds + ' שניות' : Math.round(d.zoomAuto.last.seconds / 60) + ' דקות'}` : ''} מהקביעה (${esc(d.zoomAuto.last.via)}, התאמה לפי ${esc(d.zoomAuto.last.how || '')})` : ''}
      </div>` : ''}

      <div class="section-title">עסק</div>
      ${d.finError ? `<div class="notice">${esc(d.finError)}</div>` : `
      <div class="tiles">
        <div class="card tile"><div class="num" style="font-size:18px">${esc(F.lastFinUpdate || '—')}</div><div class="lbl">עדכון פיננסים אחרון</div></div>
        <div class="card tile"><div class="num" style="font-size:18px">${esc(F.lastMeetingsRun || 'עוד לא רץ מאז העדכון')}</div><div class="lbl">עדכון פגישות אחרון</div></div>
      </div>`}
    `);
    $app.querySelectorAll('[data-filter]').forEach((a) => {
      a.addEventListener('click', () => { state.filter = a.dataset.filter; LS.set('lf_filter', state.filter); });
    });
  }

  // ---------- נתב ----------
  function route() {
    navSeq++;
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

  function applyMe(me) {
    state.role = me.role; state.realRole = me.realRole || me.role;
    state.email = me.email; state.bookingUrl = me.bookingUrl; state.bookingEmbedUrl = me.bookingEmbedUrl || '';
    if (me.undoCount != null) state.undoCount = me.undoCount;
    updateUndoBtn();
    LS.set('lf_role', state.realRole);
    if (state.viewAs && state.realRole !== 'admin') { state.viewAs = ''; LS.del('lf_viewas'); }
  }

  async function boot() {
    if (!state.session) return renderLogin();
    // אם כבר נכנסו בעבר – מציגים מיד, ובודקים את החיבור ברקע
    const cachedMe = store.get('me');
    const checkMe = api('me').then((me) => {
      const changed = !cachedMe || cachedMe.role !== me.role || cachedMe.realRole !== me.realRole;
      applyMe(me); store.set('me', me);
      return changed;
    });
    if (cachedMe) {
      applyMe(cachedMe);
      checkMe.then((changed) => { if (changed) route(); })
        .catch((e) => { if (e.code === 'FORBIDDEN') renderLogin(e.message); });
    } else {
      try { await checkMe; } catch (e) {
        if (e.code === 'AUTH' || e.code === 'FORBIDDEN') return renderLogin(e.code === 'FORBIDDEN' ? e.message : '');
        return errorView('Liel Fitness', e);
      }
    }
    window.onhashchange = route;
    if (!location.hash || location.hash === '#/' ) location.replace(isAdmin() ? '#/home' : '#/leads');
    route();
    refreshAlerts();
    setTimeout(() => prefetchAll(false), 400);
    // רענון ברקע כשחוזרים לאפליקציה
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.session) {
        if (pendingBooking && Date.now() - pendingBooking.at < 30 * 60000) { watchBooking(pendingBooking.lead); pendingBooking = null; }
        leadsFetchedAt = 0; refreshAlerts(); prefetchAll(false);
        if (!isEditing() && !cardBusy()) route();
      }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  boot();
})();
