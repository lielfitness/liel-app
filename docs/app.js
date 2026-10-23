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
    redoCount: 0,
    unread: 0,
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
  // צבע לכל סטטוס – לפי הרשימה הנפתחת בגיליון (רקע, טקסט)
  const STATUS_COLORS = {
    'ליד חדש': ['#d0e4f5', '#0b4a80'],
    'ניסיון שיחה': ['#ffe5a0', '#473821'],
    'WA נשלח': ['#fff3cd', '#7a5a00'],
    'שיחה בוצעה': ['#d4edda', '#155724'],
    'זום נקבע': ['#11734b', '#d4edbc'],
    'פגישה בוטלה': ['#ffcc99', '#993f00'],
    'נסגר': ['#b2dfdb', '#004d40'],
    'Ghosting': ['#3d3d3d', '#e5e5e5'],
    'לא מעוניין': ['#b10202', '#ffcfc9'],
    'עתידי': ['#e6cff2', '#5a3286'],
    'לא רלוונטי': ['#ffcfc9', '#b10202'],
  };
  function statusStyle(key) {
    const c = STATUS_COLORS[key];
    return c ? `background:${c[0]};color:${c[1]};border-color:${c[0]}` : '';
  }
  function statusPill(s, key) {
    if (!s) return '<span class="pill warn">ללא סטטוס</span>';
    return `<span class="pill" style="${statusStyle(key || String(s).trim())}">${esc(s)}</span>`;
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
        <img class="logo-mark" src="icons/icon.svg" alt="Liel Fitness" width="96" height="96">
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
    $app.innerHTML = '<div class="splash"><img class="logo-mark" src="icons/icon.svg" alt="Liel Fitness" width="96" height="96"><div class="splash-title">צוות ליאל פיטנס</div></div>';
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
    if (isAdmin()) {
      items.push({ h: '#/home', ico: '🏠', t: 'בית' });
      items.push({ h: '#/leads', ico: '👥', t: 'לידים' });
      items.push({ h: '#/coaches', ico: '🏋️', t: 'מאמנים' });
      items.push({ h: '#/finance', ico: '📊', t: 'פיננסים' });
      items.push({ h: '#/more', ico: '☰', t: 'עוד', badge: untreatedCount() });
      return items;
    }
    items.push({ h: '#/leads', ico: '👥', t: 'לידים' });
    items.push({ h: '#/untreated', ico: '⏰', t: 'לא טופלו', badge: untreatedCount() });
    items.push({ h: '#/ghosting', ico: '👻', t: 'גוסטינג' });
    items.push({ h: '#/month', ico: '💰', t: 'החודש שלי' });
    return items;
  }
  function untreatedCount() {
    return state.leads ? state.leads.filter((l) => l.untreated).length : 0;
  }

  let lastShellHash = '';
  function shell(title, content, opts) {
    opts = opts || {};
    const keepY = lastShellHash === location.hash ? window.scrollY : null;
    lastShellHash = location.hash;
    const cur = '#/' + (location.hash.replace(/^#\/?/, '').split('/')[0] || '');
    const nav = navItems();
    const link = (n) => `<a href="${n.h}" class="${cur === n.h ? 'active' : ''}"><span class="ico">${n.ico}</span><span>${esc(n.t)}</span>${n.badge ? `<span class="badge">${n.badge}</span>` : ''}</a>`;
    $app.innerHTML = `
      <header class="topbar">
        ${opts.back ? `<button class="icon-btn" data-act="back" aria-label="חזרה">→</button>` : ''}
        <h1>${esc(title)}</h1>
        <nav class="topnav">${nav.map(link).join('')}</nav>
        <span class="spacer"></span>
        <a class="icon-btn bell" data-bell href="#/notifs" title="התראות" aria-label="התראות" style="text-decoration:none">🔔<span class="badge" ${state.unread ? '' : 'hidden'}>${state.unread}</span></a>
        <a class="icon-btn" data-alerts href="#/zooms" title="זומים לשיוך" style="text-decoration:none" ${state.alertsCount ? '' : 'hidden'}>📅<span class="badge">${state.alertsCount}</span></a>
        ${state.realRole === 'admin' && !state.viewAs ? `<button class="icon-btn" data-act="viewas-on" title="תצוגה כמו שי" style="font-size:14px">👁 כמו שי</button>` : ''}
        <button class="icon-btn undo-btn" data-act="undo" aria-label="בטל פעולה אחרונה" title="בטל (פעולה אחרונה)" ${state.undoCount ? '' : 'disabled'}>↶</button>
        <button class="icon-btn undo-btn" data-act="redo" aria-label="בצע שוב" title="בצע שוב (מחזיר פעולה שבוטלה)" ${state.redoCount ? '' : 'disabled'}>↷</button>
        <button class="icon-btn" data-act="refresh" aria-label="רענון" title="רענון">🔄</button>
        <button class="icon-btn" data-act="logout" aria-label="יציאה" title="יציאה (${esc(state.email)})" style="font-size:14px">יציאה</button>
      </header>
      ${state.viewAs ? `<div class="viewas-bar"><span>👁 תצוגה כמו שי – כך היא רואה את האפליקציה. שמירות נכתבות באמת לגיליון.</span><button class="btn small secondary" data-act="viewas-off">חזרה לתצוגה שלי</button></div>` : ''}
      <main>${content}</main>
      <nav class="bottomnav">${nav.map(link).join('')}</nav>`;
    $app.querySelector('[data-act="refresh"]').onclick = () => { state.forceFresh = true; softRefresh(); refreshAlerts(); toast('מרענן…'); };
    $app.querySelector('[data-act="logout"]').onclick = () => { if (confirm('לצאת מהאפליקציה?')) logout(); };
    $app.querySelector('[data-act="undo"]').onclick = undoLast;
    $app.querySelector('[data-act="redo"]').onclick = redoLast;
    const vOn = $app.querySelector('[data-act="viewas-on"]');
    if (vOn) vOn.onclick = () => setViewAs('leads');
    const vOff = $app.querySelector('[data-act="viewas-off"]');
    if (vOff) vOff.onclick = () => setViewAs('');
    const back = $app.querySelector('[data-act="back"]');
    if (back) back.onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/leads'));
    if (keepY != null) window.scrollTo(0, keepY);
  }

  /** מספרים בכותרת ובתפריט – מתעדכנים במקום, בלי לצייר את המסך מחדש */
  function updateBadges() {
    const a = $app.querySelector('[data-alerts]');
    if (a) { a.hidden = !state.alertsCount; a.querySelector('.badge').textContent = state.alertsCount; }
    const bb = $app.querySelector('[data-bell] .badge');
    if (bb) { bb.hidden = !state.unread; bb.textContent = state.unread > 99 ? '99+' : state.unread; }
    const n = untreatedCount();
    $app.querySelectorAll('nav a[href="#/untreated"], nav a[href="#/more"]').forEach((el) => {
      let b = el.querySelector('.badge');
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement('span'); b.className = 'badge'; el.appendChild(b); }
      b.textContent = n;
    });
  }

  async function setViewAs(v) {
    state.viewAs = v;
    if (v) LS.set('lf_viewas', v); else LS.del('lf_viewas');
    state.leads = null; state.month = null; state.alertsCount = 0; leadsFetchedAt = 0; undoStack = null;
    $app.innerHTML = '<div class="splash"><img class="logo-mark" src="icons/icon.svg" alt="Liel Fitness" width="96" height="96"><div class="splash-title">צוות ליאל פיטנס</div></div>';
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
    store.set('leads', Object.assign({ leads: state.leads.filter((l) => !l._pending) }, state.meta));
    updateBadges();
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
      (state.leads || []).forEach((l) => { if (isPending(l.id)) local[l.id] = l; });
      const pk = (x) => String(x || '').replace(/\D/g, '').slice(-9);
      const temps = (state.leads || []).filter((t) => t._pending && !d.leads.some((x) => pk(x.phone) === pk(t.phone) && x.entry === t.entry));
      d.leads = temps.concat(d.leads.map((l) => local[l.id] || l));
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
      if (n !== state.alertsCount) { state.alertsCount = n; updateBadges(); }
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
    revalidateLeads(updateLeadsView);
  }

  // שורות שנערכו במסך הזה נשארות גלויות גם אם כבר לא מתאימות לסינון (עד שמחליפים סינון/חיפוש)
  let stickyIds = new Set();
  function leadsListNow() {
    return state.leads.filter((l) => stickyIds.has(l.id) || (matchesFilter(l, state.filter) && matchSearch(l, state.search))).sort(sortNewest);
  }
  function chipsHtml() {
    const statuses = state.meta.statuses;
    const counts = {};
    statuses.forEach((st) => { counts[st] = state.leads.filter((l) => matchesFilter(l, 's:' + st)).length; });
    const waitingN = state.leads.filter((l) => matchesFilter(l, 'waiting')).length;
    const chips = FILTERS.map((f) => ({ k: f.k, t: f.t, n: state.leads.filter(f.f).length }))
      .concat(state.meta.waitingFilter ? [{ k: 'waiting', t: 'ממתינים', n: waitingN }] : [])
      .concat(statuses.filter((st) => counts[st]).map((st) => ({ k: 's:' + st, t: st, n: counts[st] })));
    return chips.map((c) => `<button class="chip ${state.filter === c.k ? 'on' : ''}" data-f="${esc(c.k)}">${esc(c.t)}<span class="n">${c.n}</span></button>`).join('');
  }
  function rowFromHtml(l) {
    const t = document.createElement('div'); t.innerHTML = gridRowHtml(l).trim(); return t.firstChild;
  }
  /** מסנכרן את השורות במסך מול הרשימה: מעדכן/מוסיף/מסיר רק מה שהשתנה. שורה שמקלידים בה לא זזה ולא נמחקת. */
  function drawResults() {
    const res = document.getElementById('results');
    if (!res) return;
    const list = leadsListNow();
    const grid = res.querySelector('.grid');
    if (!grid || !list.length) { res.innerHTML = gridHtml(list); return; }
    const map = {};
    grid.querySelectorAll('.g-row[data-id]').forEach((el) => { map[el.dataset.id] = el; });
    let prev = grid.querySelector('.g-head');
    list.forEach((l) => {
      let el = map[l.id];
      if (el) { delete map[l.id]; patchRow(l.id, l); } else el = rowFromHtml(l);
      if (prev.nextSibling !== el) prev.after(el);
      prev = el;
    });
    Object.values(map).forEach((el) => { if (!el.contains(document.activeElement)) el.remove(); });
  }
  function updateLeadsView() {
    if (location.hash !== '#/leads' || !document.getElementById('results') || !state.leads) return;
    const c = document.getElementById('chips');
    if (c) c.innerHTML = chipsHtml();
    drawResults();
  }

  function renderLeadsView() {
    if (state.filter === 'all') state.filter = 'active';
    if (state.filter === 'waiting' && !state.meta.waitingFilter) state.filter = 'active';
    stickyIds = new Set();

    shell('לידים', `
      <div class="row search-row">
        <input class="search grow" type="search" placeholder="חיפוש לפי שם, טלפון או מייל" value="${esc(state.search)}" id="q" autocomplete="off">
        <button class="btn add-lead" data-act="add-lead">＋ ליד</button>
      </div>
      <div class="chips" id="chips">${chipsHtml()}</div>
      <div id="results"></div>`);

    bindGrid(document.getElementById('results'));
    drawResults();
    $app.querySelector('[data-act="add-lead"]').onclick = openAddLead;
    const q = document.getElementById('q');
    q.oninput = () => { state.search = q.value.trim(); stickyIds = new Set(); drawResults(); };
    document.getElementById('chips').onclick = (ev) => {
      const b = ev.target.closest('.chip[data-f]');
      if (!b) return;
      state.filter = b.dataset.f; LS.set('lf_filter', state.filter);
      $app.querySelectorAll('.chip[data-f]').forEach((x) => x.classList.toggle('on', x === b));
      stickyIds = new Set();
      drawResults();
    };
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
    return `<select class="st-sel" style="${statusStyle(key)}" data-status aria-label="סטטוס">
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
  const aliasOf = {};         // tmp-… → המזהה האמיתי, אחרי שליד שנוסף ידנית נשמר בגיליון
  function realId(id) { return aliasOf[id] || id; }
  function findLead(id) { id = realId(id); return (state.leads || []).find((l) => l.id === id) || null; }
  function isPending(id) {
    return !!pendingByLead[id] || Object.keys(aliasOf).some((t) => aliasOf[t] === id && pendingByLead[t]);
  }

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
    lead = findLead(lead.id) || lead;   // תמיד על הגרסה העדכנית שבזיכרון
    const before = lead;
    const local = applyLocal(lead, action, params);
    setLead(local);
    hooks.onChange && hooks.onChange(local, 'local');
    const id = lead.id;
    const seq = (seqByLead[id] = (seqByLead[id] || 0) + 1);
    pendingByLead[id] = (pendingByLead[id] || 0) + 1;
    const undoEntry = { leadId: id, before: before };
    pushUndoLocal(undoEntry); clearRedoLocal();
    state.undoCount++; state.redoCount = 0; updateUndoBtn();
    const run = () => {
      const cur = findLead(id) || lead;
      if (String(cur.id).startsWith('tmp-')) return Promise.reject(new Error('הליד עוד לא נשמר בגיליון'));
      return api(action, Object.assign({}, params, { row: cur.row, id: cur.id }));
    };
    const p = (queueByLead[id] || Promise.resolve()).catch(() => {}).then(run);
    queueByLead[id] = p;
    p.then((d) => {
      markDerivedStale();
      if (d.undoCount != null) { state.undoCount = d.undoCount; state.redoCount = d.redoCount || 0; updateUndoBtn(); }
      if (seq === seqByLead[realId(id)] && d.lead) { setLead(d.lead); hooks.onChange && hooks.onChange(d.lead, 'server'); }
      hooks.onOk && hooks.onOk(d);
      if (d.ghost) toast(d.ghost.copied ? 'הועתק ללשונית הגוסטינג ✓' : d.ghost.reason, !d.ghost.copied && !/כבר קיים/.test(d.ghost.reason));
      if (d.reward && d.reward.warning) toast('⚠️ ' + d.reward.warning, true);
    }).catch((e) => {
      if (e.code === 'AUTH') return;
      state.undoCount = Math.max(0, state.undoCount - 1); updateUndoBtn();
      dropUndoLocal(undoEntry);
      if (seq === seqByLead[realId(id)]) { const b = findLead(id) ? withId(before, findLead(id)) : before; setLead(b); hooks.onChange && hooks.onChange(b, 'revert'); }
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
  // ↷: מה שבוטל – כדי שה"בצע שוב" יופיע במסך מיד
  let redoStack = null;
  function getRedoStack() { if (!redoStack) redoStack = store.get('redo') || []; return redoStack; }
  function saveRedoStack() { store.set('redo', getRedoStack().slice(-15)); }
  function pushRedoLocal(entry) { const st = getRedoStack(); st.push(entry); while (st.length > 15) st.shift(); saveRedoStack(); }
  function dropRedoLocal(entry) { const st = getRedoStack(); const i = st.indexOf(entry); if (i >= 0) { st.splice(i, 1); saveRedoStack(); } }
  function clearRedoLocal() { redoStack = []; saveRedoStack(); }
  /** גרסה שמורה של ליד, עם המזהה והשורה של הליד כפי שהוא עכשיו */
  function withId(saved, cur) { return Object.assign({}, saved, { id: cur.id, row: cur.row, _pending: cur._pending }); }

  /** מציג ליד שהשתנה – רק במקום שבו הוא מופיע במסך */
  function showLead(lead) {
    if (rowEl(lead.id)) patchRow(lead.id, lead);
    else if (onLeadCard(lead.id)) { if (!cardBusy()) renderLead(lead); }
    else if (location.hash === '#/untreated' && !isEditing()) renderUntreated();
  }

  function updateUndoBtn() {
    const b = $app.querySelector('[data-act="undo"]');
    if (b) b.disabled = !state.undoCount;
    const r = $app.querySelector('[data-act="redo"]');
    if (r) r.disabled = !state.redoCount;
  }
  function syncUndoCounts(d) {
    if (d && d.undoCount != null) state.undoCount = d.undoCount;
    if (d && d.redoCount != null) state.redoCount = d.redoCount;
    updateUndoBtn();
  }
  function refetchUndoCounts() { api('undoCount').then(syncUndoCounts).catch(() => {}); }

  /** רענון ברקע של המסך הנוכחי – מעדכן רק מה שהשתנה */
  function onLeadsChanged() {
    updateBadges();
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts[0] === 'leads') updateLeadsView();
    else if (parts[0] === 'lead' && parts[1]) { const l = findLead(decodeURIComponent(parts[1])); if (l && !cardBusy()) renderLead(l); }
    else if (parts[0] === 'untreated' && !isEditing()) renderUntreated();
  }
  function softRefresh() {
    const page = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (!['leads', 'lead', 'untreated'].includes(page) && !isEditing()) route();   // מסכים אחרים: מוצגים מהזיכרון ומתעדכנים
    leadsFetchedAt = 0;
    refreshLeads(true).then((ch) => { if (ch) onLeadsChanged(); }).catch(() => {});
  }
  let undoChain = Promise.resolve();
  /**
   * ↶ ו-↷: המסך משתנה מיד (מהמחסנית המקומית), הגיליון ברקע – לפי הסדר, אחרי שכל השמירות שבדרך הסתיימו.
   * אם הגיליון לא מאשר – המסך חוזר למה שהיה.
   */
  function undoRedo(isUndo) {
    if (!(isUndo ? state.undoCount : state.redoCount)) return;
    const entry = (isUndo ? getUndoStack() : getRedoStack()).pop() || null;
    isUndo ? saveUndoStack() : saveRedoStack();
    let current = null, reinserted = false, removed = null, removedAt = -1, back = null;
    if (entry && entry.kind === 'delete' && state.leads && !findLead(entry.leadId)) {
      // ↶ מחיקה → הליד חוזר
      state.leads.splice(Math.max(0, entry.at || 0), 0, entry.before); persistLeads(); reinserted = true;
      back = { kind: 'redelete', leadId: entry.leadId, before: entry.before, at: entry.at };
      updateLeadsView();
    } else if (entry && entry.kind === 'redelete' && state.leads) {
      // ↷ מחיקה → הליד יורד שוב
      removedAt = state.leads.findIndex((l) => l.id === entry.leadId);
      if (removedAt >= 0) {
        removed = state.leads[removedAt]; state.leads.splice(removedAt, 1); persistLeads();
        back = { kind: 'delete', leadId: removed.id, before: removed, at: removedAt };
        if (onLeadCard(removed.id)) location.hash = '#/leads'; else updateLeadsView();
      }
    } else if (entry && state.leads) {
      current = findLead(entry.leadId);
      if (current) {
        const b = withId(entry.before, current);
        setLead(b); showLead(b);
        back = { leadId: current.id, before: current };
      }
    }
    if (back) (isUndo ? pushRedoLocal : pushUndoLocal)(back);
    if (isUndo) { state.undoCount = Math.max(0, state.undoCount - 1); state.redoCount++; }
    else { state.redoCount = Math.max(0, state.redoCount - 1); state.undoCount++; }
    updateUndoBtn();
    toast(isUndo ? '↶ בוטל' : '↷ בוצע שוב');
    const revert = () => {
      if (current) { setLead(current); showLead(current); }
      if (reinserted) { state.leads = state.leads.filter((l) => l.id !== entry.leadId); persistLeads(); updateLeadsView(); }
      if (removed) { state.leads.splice(Math.max(0, removedAt), 0, removed); persistLeads(); updateLeadsView(); }
      if (back) (isUndo ? dropRedoLocal : dropUndoLocal)(back);
      if (entry) (isUndo ? pushUndoLocal : pushRedoLocal)(entry);
    };
    undoChain = undoChain.then(async () => {
      await Promise.allSettled(Object.values(queueByLead));
      try {
        const d = await api(isUndo ? 'undo' : 'redo');
        syncUndoCounts(d);
        if (d.done) {
          if (d.lead) { setLead(d.lead); showLead(d.lead); }
          toast(d.message + (d.warning ? ' · ⚠️ ' + d.warning : ''), !!d.warning);
          markDerivedStale();
        } else {
          revert();
          toast(d.message, true);
          softRefresh();
        }
      } catch (e) {
        revert();
        if (e.code !== 'AUTH') toast((isUndo ? 'הביטול' : 'הביצוע מחדש') + ' נכשל, המסך הוחזר: ' + e.message, true);
        refetchUndoCounts();
      }
    });
  }
  function undoLast() { undoRedo(true); }
  function redoLast() { undoRedo(false); }

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
    el.classList.toggle('pending', !!lead._pending);
    const nm = el.querySelector('.g-name a');
    nm.textContent = lead.name || '(ללא שם)'; nm.setAttribute('href', '#/lead/' + lead.id);
    const ph = el.querySelector('.g-phone a');
    ph.textContent = lead.phone || ''; ph.setAttribute('href', telHref(lead.phone));
    el.querySelector('.g-entry').textContent = fmtIso(lead.entry) || lead.entryRaw || '';
    el.querySelector('.g-att').innerHTML = attemptsHtml(lead);
    const sel = el.querySelector('select[data-status]');
    if (!sel || document.activeElement !== sel) el.querySelector('.g-status').innerHTML = statusSelect(lead);
    el.querySelector('.g-zoom').textContent = lead.zoomDate ? '🎥 ' + fmtIso(lead.zoomDate) : '';
    el.querySelectorAll('textarea[data-field]').forEach((t) => {
      if (document.activeElement !== t) t.value = lead[t.dataset.field] || '';
    });
  }

  function rowSave(lead, action, params, okMsg) {
    stickyIds.add(lead.id);
    return optimistic(lead, action, params, {
      onChange: (l, why) => { patchRow(l.id, l); if (why === 'local') markRow(l.id, 'busy', 'שומר…'); },
      onOk: () => markRow(lead.id, 'ok', okMsg || 'נשמר ✓'),
      onFail: () => markRow(lead.id, 'err', 'לא נשמר ✕'),
    });
  }

  function bindGrid(root) {
    const leadOf = (el) => {
      const row = el.closest('.g-row[data-id]');
      return row && findLead(row.dataset.id);
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
    stickyIds.add(tmpId);
    updateLeadsView();
    markRow(tmpId, 'busy', 'שומר…');
    toast('נוסף ✓ (נשמר לגיליון ברקע)');
    const dropTemp = () => {
      state.leads = state.leads.filter((l) => l.id !== tmpId); persistLeads();
      updateLeadsView();
      if (onLeadCard(tmpId)) location.hash = '#/leads';
    };
    // פעולות על הליד בזמן שהוא נשמר מחכות בתור לסיום ההוספה, ואז נשלחות עם השורה האמיתית
    const addP = api('addLead', Object.assign({}, f, { force: !!force })).then((d) => {
      if (d.duplicate) {
        // השרת מצא כפילות שלא הייתה ברשימה שבזיכרון
        dropTemp();
        if (confirm(`הטלפון כבר קיים אצל: ${d.duplicate.map((x) => x.name).join(', ')}. להוסיף בכל זאת?`)) addLeadOptimistic(f, true);
        return;
      }
      if (!d.lead) return;
      const i = state.leads.findIndex((l) => l.id === tmpId);
      const cur = i >= 0 ? state.leads[i] : null;
      // אם כבר נערך בזמן השמירה – שומרים את מה שבמסך, עם המזהה והשורה האמיתיים
      const real = cur && isPending(tmpId)
        ? Object.assign({}, cur, { id: d.lead.id, row: d.lead.row, entry: d.lead.entry, entryRaw: d.lead.entryRaw })
        : Object.assign({}, d.lead);
      delete real._pending;
      aliasOf[tmpId] = real.id;
      if (queueByLead[tmpId]) queueByLead[real.id] = queueByLead[tmpId];
      if (seqByLead[tmpId]) seqByLead[real.id] = Math.max(seqByLead[real.id] || 0, seqByLead[tmpId]);
      const dup = state.leads.findIndex((l) => l.id === real.id);
      if (dup >= 0 && dup !== i) state.leads.splice(dup, 1);
      const j = state.leads.findIndex((l) => l.id === tmpId);
      if (j >= 0) state.leads[j] = real; else state.leads.unshift(real);
      persistLeads();
      if (stickyIds.has(tmpId)) stickyIds.add(real.id);
      if (rowEl(tmpId)) { patchRow(tmpId, real); markRow(real.id, 'ok', 'נשמר ✓'); }
      if (onLeadCard(tmpId)) {
        history.replaceState(null, '', '#/lead/' + real.id); lastShellHash = location.hash;
        if (!cardBusy()) renderLead(real);
      }
      markDerivedStale();
    }).catch((e) => {
      dropTemp();
      if (e.code !== 'AUTH') toast('הליד לא נוסף לגיליון: ' + e.message, true);
      throw e;
    });
    queueByLead[tmpId] = addP;
    addP.catch(() => {});
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
    pushUndoLocal(entry); clearRedoLocal();
    state.undoCount++; state.redoCount = 0;
    location.hash = '#/leads';
    toast('נמחק ✓ (↶ מחזיר)');
    api('deleteLead', { row: lead.row, id: lead.id, name: lead.name, phone: lead.phone, force: true }).then((d) => {
      syncUndoCounts(d);
      markDerivedStale();
    }).catch((e) => {
      dropUndoLocal(entry); state.undoCount = Math.max(0, state.undoCount - 1); updateUndoBtn();
      state.leads.splice(Math.max(0, idx), 0, lead); persistLeads();
      updateLeadsView();
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
    if (isAdmin() && !state.viewAs) { jobs.push(prefetchOne('coaches', 'coaches')); jobs.push(prefetchOne('finance', 'finance')); }
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
    shell(isAdmin() ? 'לידים שלא טופלו' : 'לא טופלו', `
      <div class="notice info">לידים פעילים בלי שום עדכון יומיים ומעלה. הוותיקים ראשונים.</div>
      ${!state.meta.hasUpdatedCol ? '<div class="notice">עמודת "עודכן לאחרונה" עוד לא קיימת בגיליון, אז החישוב לפי תאריכי כניסה/שיחות בלבד.</div>' : ''}
      ${leadCardsHtml(list, { idle: true, empty: 'אין לידים שמחכים – כל הכבוד! 🎉' })}`);
    bindTableRows();
  }

  // ---------- מסך: כרטיס ליד ----------
  async function viewLead(id) {
    if (!state.leads && !store.get('leads')) loading('כרטיס ליד');
    try { await ensureLeads(); } catch (e) { return errorView('כרטיס ליד', e); }
    if (aliasOf[id]) { history.replaceState(null, '', '#/lead/' + aliasOf[id]); id = aliasOf[id]; }
    let lead = findLead(id);
    if (!lead) {
      loading('כרטיס ליד');
      try { await ensureLeads(true); } catch (e) { return errorView('כרטיס ליד', e); }
      lead = state.leads.find((l) => l.id === id);
    }
    if (!lead) return shell('כרטיס ליד', '<div class="empty">הליד לא נמצא. אולי הפרטים שלו שונו בגיליון.</div>', { back: true });
    renderLead(lead);
    revalidateLeads(() => {
      const fresh = findLead(id);
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

  let lastCardKey = '';
  function renderLead(lead) {
    // אותו ליד בדיוק כבר מוצג – לא מציירים מחדש (בלי קפיצה ובלי לאבד מה שפתוח)
    const key = location.hash + '|' + JSON.stringify(lead);
    if (key === lastCardKey && lastShellHash === location.hash && $app.querySelector('#form')) return;
    lastCardKey = key;
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
              <div class="status-grid">${statusList.map((s) => `<button type="button" class="chip ${s === sk(lead) ? 'on' : ''}" data-status="${esc(s)}" style="${s === sk(lead) ? statusStyle(s) : ''}">${esc(s)}</button>`).join('')}</div>
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
          ${state.realRole === 'admin' && !state.viewAs && !lead._pending ? '<button class="btn danger small" data-act="delete-lead" style="margin-top:14px">🗑 מחיקת ליד</button>' : ''}
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
              ${infoRow('מה ניסית', lead.improve)}
              ${infoRow('למה עכשיו', lead.change)}
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
        $app.querySelectorAll('[data-status]').forEach((x) => {
          x.classList.toggle('on', x.dataset.status === status);
          x.setAttribute('style', x.dataset.status === status ? statusStyle(status) : '');
        });
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
    const issues = (d.health && d.health.issues) || [];
    shell('תמונת מצב', `
      ${issues.map((x) => `<div class="health-warn">⚠️ ${esc(x)}</div>`).join('')}
      <div class="section-title" style="margin-top:4px">לידים</div>
      <div class="tiles">
        <a class="card tile" href="#/leads" data-filter="s:ליד חדש"><div class="num">${L.newStatus}</div><div class="lbl">בסטטוס "ליד חדש"</div></a>
        <a class="card tile ${L.untreated ? 'alert' : ''}" href="#/untreated"><div class="num">${L.untreated}</div><div class="lbl">לא טופלו יומיים+</div></a>
      </div>
      ${d.stage2 ? `<div class="section-title">מאמנים ופיננסים</div>
      <div class="tiles">
        <a class="card tile ${d.stage2.lateUncharged ? 'alert' : ''}" href="#/coaches"><div class="num">${d.stage2.lateUncharged}</div><div class="lbl">ביטולים מאוחרים שלא חויבו</div></a>
        <a class="card tile ${d.stage2.lowCoaches ? 'alert' : ''}" href="#/coaches" data-low="1"><div class="num">${d.stage2.lowCoaches}</div><div class="lbl">מאמנים עם 2 פגישות או פחות</div></a>
        <a class="card tile ${d.stage2.review ? 'alert' : ''}" href="#/finance"><div class="num">${d.stage2.review}</div><div class="lbl">תנועות "לבדיקה"</div></a>
      </div>` : ''}

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

      <div class="section-title">עסק</div>
      ${d.finError ? `<div class="notice">${esc(d.finError)}</div>` : `
      <div class="tiles">
        <div class="card tile"><div class="num" style="font-size:18px">${esc(F.lastFinUpdate || '—')}</div><div class="lbl">עדכון פיננסים אחרון</div></div>
        <div class="card tile"><div class="num" style="font-size:18px">${esc(F.lastMeetingsRun || 'עוד לא רץ מאז העדכון')}</div><div class="lbl">עדכון פגישות אחרון</div></div>
        ${F.month ? `
        <div class="card tile"><div class="num">${ils(Math.round(F.month.income))}</div><div class="lbl">הכנסות החודש (כולל מע״מ)</div>
          <div class="muted small">${ils(Math.round(F.month.incomeNet))} אחרי מע״מ · עד העדכון האחרון</div></div>
        <div class="card tile"><div class="num">${ils(Math.round(F.month.expenses))}</div><div class="lbl">הוצאות החודש (כולל מע״מ)</div>
          <div class="muted small">${ils(Math.round(F.month.expensesNet))} אחרי מע״מ · עד העדכון האחרון</div></div>` : ''}
      </div>`}
    `);
    // לחיצה ארוכה על הכותרת → מסך בדיקות נסתר
    const h1 = $app.querySelector('.topbar h1');
    let lp = null;
    const cancelLp = () => clearTimeout(lp);
    h1.addEventListener('pointerdown', () => { lp = setTimeout(() => { location.hash = '#/status'; }, 700); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => h1.addEventListener(ev, cancelLp));
    h1.addEventListener('contextmenu', (e) => e.preventDefault());
    const low = $app.querySelector('[data-low]');
    if (low) low.addEventListener('click', () => { coachFilter = 'low'; });
    $app.querySelectorAll('[data-filter]').forEach((a) => {
      a.addEventListener('click', () => { state.filter = a.dataset.filter; LS.set('lf_filter', state.filter); });
    });
  }

  // ---------- שלב 2: מאמנים ופגישות (ליאל בלבד) ----------
  // הכל נטען מראש (מאמנים + כל היסטוריית הפגישות) – הכרטיסים נפתחים מהזיכרון
  let coachFilter = 'all';
  const leftCls = (c) => (c.left == null ? '' : c.left <= 0 ? 'done' : c.left <= 2 ? 'low' : '');
  const COACH_FILTERS = [
    { k: 'all', t: 'הכל', f: () => true },
    { k: 'low', t: 'נגמרות', f: (c) => c.left != null && c.left >= 1 && c.left <= 2 },
    { k: 'done', t: 'הסתיימו', f: (c) => c.left != null && c.left <= 0 },
  ];
  function confirmSheet(title, html, okText, onOk) {
    const sh = openSheet(`
      <div class="row"><b class="grow">${esc(title)}</b><button class="icon-btn" data-x aria-label="סגירה">✕</button></div>
      ${html}
      <div class="row"><button class="btn grow" data-ok>${esc(okText)}</button><button class="btn ghost" data-x>ביטול</button></div>`);
    sh.el.querySelector('[data-ok]').onclick = () => { sh.close(); onOk(); };
    return sh;
  }
  /** משנה את הנתונים בזיכרון ומצייר מחדש את המסך הנוכחי (בלי לחכות לשרת) */
  function patchStore(name, fn) {
    const d = store.get(name);
    if (!d) return null;
    fn(d); store.set(name, d);
    return d;
  }
  function redrawStage2() {
    const page = location.hash.replace(/^#\/?/, '').split('/');
    if (page[0] === 'coaches' && store.get('coaches')) renderCoaches(store.get('coaches'));
    else if (page[0] === 'coach' && page[1]) { const d = store.get('coaches'); if (d) renderCoach(d, decodeURIComponent(page[1])); }
    else if (page[0] === 'finance' && store.get('finance')) renderFinance(store.get('finance'));
  }
  const lateUndo = {};   // id → פגישה שנוקתה (להצגת ↶)

  function viewCoaches() { return swr('coaches', 'coaches', {}, 'מאמנים ופגישות', renderCoaches); }

  function renderCoaches(d) {
    const late = (d.late || []);
    const open = late.filter((m) => m.charged === 'לא');
    const cf = COACH_FILTERS.find((x) => x.k === coachFilter) || COACH_FILTERS[0];
    const list = (d.coaches || []).filter(cf.f);
    const online = d.online || [];
    const total = online.reduce((a, o) => a + (Number(o.amount) || 0), 0);
    shell('מאמנים ופגישות', `
      <div class="card row" style="align-items:center">
        <div class="grow small">הורדת פגישות אחרונה: <b>${esc(d.lastRun || '—')}</b></div>
        <button class="btn small secondary" data-act="run-meetings">▶️ הרץ עכשיו</button>
      </div>
      <div class="section-title">ביטולים מאוחרים${open.length ? ` – ${open.length} לא חויבו` : ''}</div>
      ${Object.keys(lateUndo).map((id) => `<div class="card mrow decided"><div class="grow small">נוקה: <b>${esc(lateUndo[id].coach)}</b> · ${esc(lateUndo[id].date)}</div><button class="btn small ghost" data-unclear="${esc(id)}">↶ ביטול</button></div>`).join('')}
      ${late.length ? `<div class="mlist">${late.map((m) => `
        <div class="card mrow ${m.charged === 'לא' ? 'late-open' : ''}" data-late="${esc(m.id)}">
          <div class="grow">
            <a href="#/coach/${encodeURIComponent(m.coach)}"><b>${esc(m.coach)}</b></a>
            <div class="muted small">${esc(m.date)} ${esc(m.time)}${m.hoursBefore != null ? ` · בוטלה ~${m.hoursBefore} שעות לפני` : ''}</div>
            <div class="small">${m.charged === 'כן' ? '💳 חויב – ירדה פגישה' : 'לא חויב'}</div>
          </div>
          ${m.charged === 'לא' ? '<button class="btn small danger" data-charge="1">לחייב</button><button class="btn small ghost" data-clear>נקה</button>' : '<button class="btn small ghost" data-charge="0">לבטל חיוב</button>'}
        </div>`).join('')}</div>` : (Object.keys(lateUndo).length ? '' : '<div class="card muted">אין ביטולים מאוחרים</div>')}
      <div class="row" style="margin:16px 0 6px;align-items:center;flex-wrap:wrap;gap:6px">
        <div class="section-title grow" style="margin:0">מאמנים בליווי (${(d.coaches || []).length})</div>
        <div class="chips" style="margin:0">${COACH_FILTERS.map((x) => `<button class="chip ${coachFilter === x.k ? 'on' : ''}" data-cf="${x.k}">${x.t}<span class="n">${(d.coaches || []).filter(x.f).length}</span></button>`).join('')}</div>
      </div>
      <div class="mlist">${list.length ? list.map((c) => `
        <a class="card mrow coach-row ${leftCls(c)}" href="#/coach/${encodeURIComponent(c.name)}">
          <div class="grow"><b>${esc(c.name)}</b></div>
          <span class="left-pill">${c.left == null ? '—' : c.left <= 0 ? 'הסתיימה' : c.left} <span class="muted">/ ${c.pkg == null ? '—' : c.pkg}</span></span>
        </a>`).join('') : '<div class="card muted">אין מאמנים בסינון הזה</div>'}</div>
      <div class="section-title">מתאמני אונליין (${online.length})</div>
      <div class="card">
        ${online.length ? `<div class="online-list">${online.map((o, i) => `
          <div class="online-row"><span class="grow">${esc(o.name)}</span><b>${ils(o.amount)}</b><button class="icon-btn" data-orm="${i}" aria-label="הסרה" title="הסרה">✕</button></div>`).join('')}
          <div class="online-row total"><span class="grow">סה״כ חודשי</span><b>${ils(total)}</b><span style="width:34px"></span></div></div>` : '<div class="muted small">אין מתאמנים ברשימה</div>'}
        <div class="row online-add">
          <input id="on-name" placeholder="שם" class="grow" autocomplete="off">
          <input id="on-amount" type="number" inputmode="numeric" placeholder="₪ לחודש" style="width:96px">
          <button class="btn small" data-act="online-add">הוספה</button>
        </div>
        <div class="muted small">רק להצגה – לא נכנס ל"תנועות" ולא משפיע על הדוחות.</div>
      </div>`);
    $app.querySelectorAll('[data-cf]').forEach((b) => { b.onclick = () => { coachFilter = b.dataset.cf; renderCoaches(d); }; });
    $app.querySelector('[data-act="run-meetings"]').onclick = (ev) => runMeetings(ev.currentTarget);
    $app.querySelectorAll('[data-late]').forEach((row) => {
      const m = late.find((x) => x.id === row.dataset.late);
      row.querySelectorAll('[data-charge]').forEach((b) => { b.onclick = () => chargeLate(m, b.dataset.charge === '1'); });
      const c = row.querySelector('[data-clear]');
      if (c) c.onclick = () => clearLate(m);
    });
    $app.querySelectorAll('[data-unclear]').forEach((b) => { b.onclick = () => unclearLate(b.dataset.unclear); });
    $app.querySelectorAll('[data-orm]').forEach((b) => { b.onclick = () => onlineRemove(online[Number(b.dataset.orm)]); });
    $app.querySelector('[data-act="online-add"]').onclick = onlineAdd;
  }

  function runMeetings(btn) {
    confirmSheet('הרצת הורדת פגישות', '<div class="small">מריץ עכשיו את אותה הורדה של יום שישי: פגישות שהתקיימו יורדות מהחבילות, והסיכום נשלח בטלגרם. פגישה לא יורדת פעמיים.</div>', 'להריץ', () => {
      btn.disabled = true; btn.textContent = 'רץ…';
      api('runMeetings').then((r) => { toast('✅ ' + r.message); refreshStage2('coaches'); markDerivedStale(); })
        .catch((e) => toast('ההורדה נכשלה: ' + e.message, true))
        .finally(() => { btn.disabled = false; btn.textContent = '▶️ הרץ עכשיו'; });
    });
  }

  /** טעינה ברקע של מסך שלב 2 ועדכון המסך אם הוא פתוח */
  function refreshStage2(name) {
    return api(name, { fresh: true }).then((d) => { store.set(name, d); if (!isEditing()) redrawStage2(); }).catch(() => {});
  }

  /** לחייב / לבטל חיוב – מיידי במסך, בגיליון דרך סקריפט הפגישות */
  function chargeLate(m, want) {
    const d = store.get('coaches');
    const c = d && d.coaches.find((x) => x.name === m.coach);
    const before = c && c.left != null ? c.left : null;
    const after = before == null ? null : before + (want ? -1 : 1);
    confirmSheet(want ? 'לחייב ביטול מאוחר' : 'לבטל את החיוב',
      `<div><b>${esc(m.coach)}</b> · ${esc(m.date)} ${esc(m.time)}</div>
       <div class="small">${want ? 'תרד פגישה מהחבילה' : 'הפגישה תחזור לחבילה'}${before != null ? `: נשארו <b>${before}</b> ← <b>${after}</b>` : ''}</div>`,
      want ? 'לחייב' : 'לבטל חיוב', () => {
        const snap = JSON.stringify(store.get('coaches'));
        patchStore('coaches', (dd) => {
          const mm = dd.late.find((x) => x.id === m.id); if (mm) mm.charged = want ? 'כן' : 'לא';
          const cc = dd.coaches.find((x) => x.name === m.coach); if (cc && cc.left != null) cc.left += want ? -1 : 1;
          const hm = (dd.meetings || []).find((x) => x.id === m.id); if (hm) hm.charged = want ? 'כן' : 'לא';
        });
        redrawStage2();
        api('lateCharge', { id: m.id, want }).then((r) => {
          toast(want ? `חויב ✓ – נשארו ל${m.coach} ${r.left}` : `החיוב בוטל ✓ – נשארו ל${m.coach} ${r.left}`);
          patchStore('coaches', (dd) => { const cc = dd.coaches.find((x) => x.name === m.coach); if (cc && r.left != null) cc.left = r.left; });
          redrawStage2(); markDerivedStale();
        }).catch((e) => { store.set('coaches', JSON.parse(snap)); redrawStage2(); toast('לא בוצע, המסך הוחזר: ' + e.message, true); });
      });
  }

  /** נקה: ראיתי, לא מחייבים – יורד מהרשימה (D לא משתנה). ↶ מחזיר. */
  function clearLate(m) {
    lateUndo[m.id] = m;
    patchStore('coaches', (dd) => { dd.late = dd.late.filter((x) => x.id !== m.id); });
    redrawStage2();
    api('lateClear', { id: m.id, coach: m.coach, date: m.date + ' ' + m.time }).then(() => { toast('נוקה ✓'); markDerivedStale(); })
      .catch((e) => { delete lateUndo[m.id]; patchStore('coaches', (dd) => { dd.late.push(m); dd.late.sort((a, b) => b.at - a.at); }); redrawStage2(); toast('לא נשמר: ' + e.message, true); });
  }
  function unclearLate(id) {
    const m = lateUndo[id];
    if (!m) return;
    delete lateUndo[id];
    patchStore('coaches', (dd) => { if (!dd.late.some((x) => x.id === id)) dd.late.push(m); dd.late.sort((a, b) => b.at - a.at); });
    redrawStage2();
    api('lateClear', { id, undo: true }).then(() => { toast('↶ חזר לרשימה'); markDerivedStale(); })
      .catch((e) => { lateUndo[id] = m; patchStore('coaches', (dd) => { dd.late = dd.late.filter((x) => x.id !== id); }); redrawStage2(); toast('לא בוצע: ' + e.message, true); });
  }

  function onlineAdd() {
    const name = document.getElementById('on-name').value.trim();
    const amount = Number(document.getElementById('on-amount').value);
    if (!name) return toast('חסר שם', true);
    if (!(amount > 0)) return toast('סכום לא תקין', true);
    const item = { name, amount };
    patchStore('coaches', (dd) => { dd.online = (dd.online || []).concat([item]); });
    redrawStage2();
    api('online', { op: 'add', name, amount }).then((r) => { patchStore('coaches', (dd) => { dd.online = r.online; }); toast('נוסף ✓'); })
      .catch((e) => { patchStore('coaches', (dd) => { dd.online = (dd.online || []).filter((x) => x !== item && !(x.name === name && x.amount === amount)); }); redrawStage2(); toast('לא נוסף: ' + e.message, true); });
  }
  function onlineRemove(o) {
    if (!o || !confirm(`להסיר את ${o.name} (${ils(o.amount)}) מרשימת מתאמני האונליין?`)) return;
    const snap = JSON.stringify(store.get('coaches'));
    patchStore('coaches', (dd) => { const i = dd.online.findIndex((x) => x.name === o.name && x.amount === o.amount); if (i >= 0) dd.online.splice(i, 1); });
    redrawStage2();
    api('online', { op: 'remove', name: o.name, amount: o.amount }).then((r) => { patchStore('coaches', (dd) => { dd.online = r.online; }); toast('הוסר ✓'); })
      .catch((e) => { store.set('coaches', JSON.parse(snap)); redrawStage2(); toast('לא הוסר: ' + e.message, true); });
  }

  // כרטיס מאמן: מהזיכרון, בלי לחכות לשרת
  function viewCoach(name) {
    const d = store.get('coaches');
    if (d) { renderCoach(d, name); return refreshStage2('coaches'); }
    loading(name);
    return api('coaches').then((dd) => { store.set('coaches', dd); if (location.hash === '#/coach/' + encodeURIComponent(name)) renderCoach(dd, name); })
      .catch((e) => errorView(name, e));
  }

  function renderCoach(d, name) {
    const c = (d.coaches || []).find((x) => x.name === name);
    if (!c) return shell(name, '<div class="empty">המאמן לא נמצא בגיליון תפעול</div>', { back: true });
    const emails = String(c.email || '').toLowerCase().split(/[,;\s]+/).filter((e) => e.includes('@'));
    const history = (d.meetings || []).filter((m) => m.coach === c.name || (m.email && emails.includes(m.email))).sort((a, b) => b.at - a.at);
    const phone = (d.phones || {})[c.name] || '';
    const tel = telHref(phone), wa = waNumber(phone);
    shell(c.name, `
      <div class="card">
        <div class="row" style="align-items:center">
          <div class="grow"><h2 style="margin:0">${esc(c.name)}</h2><div class="muted small ltr-text">${esc(c.email)}</div></div>
          <div class="left-big ${leftCls(c)}"><div class="num">${c.left == null ? '—' : c.left}</div><div class="lbl">${c.left != null && c.left <= 0 ? 'החבילה הסתיימה' : 'נשארו מתוך ' + (c.pkg == null ? '—' : c.pkg)}</div></div>
        </div>
        <div class="quick" style="margin-top:10px">
          ${tel ? `<a class="btn" href="${esc(tel)}">📞 חיוג</a>` : ''}
          ${wa ? `<a class="btn green" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">💬 ווטסאפ</a>` : ''}
          ${!tel ? '<div class="muted small">לא נמצא טלפון (לפי המייל בגיליון הלידים)</div>' : ''}
        </div>
        <div class="row renew-row">
          <label for="rn" class="small">חידוש חבילה ל-</label>
          <input id="rn" type="number" min="1" max="100" inputmode="numeric" value="${esc(c.pkg || 12)}" style="width:72px">
          <span class="small">פגישות</span>
          <button class="btn small" data-act="renew">חידוש</button>
        </div>
      </div>
      <div class="section-title">היסטוריית פגישות (${history.length})</div>
      ${history.length ? `<div class="mlist">${history.map((m) => `
        <div class="card mrow">
          <div class="grow"><b>${esc(m.date)}</b> <span class="muted">${esc(m.time)}</span><div class="small">${esc(m.status)}</div></div>
          <span class="pill ${m.charged === 'כן' ? '' : 'warn'}">${m.charged === 'כן' ? 'ירדה' : m.charged === 'לא' ? 'לא ירדה' : esc(m.charged || '—')}</span>
          ${m.left != null && m.left !== '' ? `<span class="muted small" title="נשארו אחרי">→ ${esc(m.left)}</span>` : ''}
        </div>`).join('')}</div>` : '<div class="card muted">אין פגישות ב"יומן פגישות"</div>'}`, { back: true });
    $app.querySelector('[data-act="renew"]').onclick = () => renewCoach(c);
  }

  function renewCoach(c) {
    const n = Math.round(Number(document.getElementById('rn').value));
    if (!(n > 0 && n <= 100)) return toast('מספר פגישות לא תקין', true);
    const left = c.left || 0;
    confirmSheet('חידוש חבילה – ' + c.name, `
      <table class="ba"><tr><th></th><th>לפני</th><th>אחרי</th></tr>
        <tr><td>בחבילה (C)</td><td>${c.pkg == null ? '—' : c.pkg}</td><td><b>${n}</b></td></tr>
        <tr><td>נשארו (D)</td><td>${left}</td><td><b>${left + n}</b></td></tr></table>
      <div class="muted small">מה שנשאר לא הולך לאיבוד: D = ${left} + ${n}</div>`, 'לחדש', () => {
      const snap = JSON.stringify(store.get('coaches'));
      patchStore('coaches', (dd) => { const cc = dd.coaches.find((x) => x.name === c.name); if (cc) { cc.pkg = n; cc.left = left + n; } });
      redrawStage2();
      api('coachRenew', { name: c.name, email: c.email, n }).then((r) => {
        patchStore('coaches', (dd) => { const cc = dd.coaches.find((x) => x.name === c.name); if (cc) { cc.pkg = r.after.pkg; cc.left = r.after.left; } });
        redrawStage2(); toast(`החבילה חודשה ✓ – ${r.after.left} פגישות`); markDerivedStale();
      }).catch((e) => { store.set('coaches', JSON.parse(snap)); redrawStage2(); toast('החידוש לא בוצע: ' + e.message, true); });
    });
  }

  // ---------- שלב 2: פיננסים ----------
  const FIN_TASK_URL = 'https://claude.ai/scheduled-task/trig_01QP8CxvKDVccpZkYZg9xXca';
  function viewFinance() { return swr('finance', 'finance', {}, 'פיננסים', renderFinance); }
  const money = (n) => (n == null ? '—' : ils(Math.round(n)));
  const decided = {};    // id → { business, undo } – החלטות "לבדיקה" מהמסך הזה
  const debtUndo = {};   // key → פריט חוב שנוקה (להצגת ↶)
  function finAdded() { return store.get('finAdded') || []; }   // הכנסות/הוצאות ידניות שנוספו מהאפליקציה (ל-↶)

  function monthDetails(title, items, total, sheetTotal, withSource) {
    const diff = sheetTotal != null && Math.abs(Math.round(total) - Math.round(sheetTotal)) > 1;
    return `<details class="card month-list"><summary>${esc(title)} – ${money(total)}</summary>
      ${diff ? `<div class="notice small">בלשונית 2026: ${money(sheetTotal)} (ההפרש מתעדכן בעדכון הפיננסים הבא)</div>` : ''}
      ${items.length ? `<table class="mtable"><tbody>${items.map((x) => `<tr><td class="nowrap">${esc(x.date.slice(0, 5))}</td><td>${esc(x.name)}</td>${withSource ? `<td class="muted small">${esc(x.source || '')}</td>` : ''}<td class="nowrap amt">${money(x.amount)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small">אין</div>'}
    </details>`;
  }

  let finView = 'cur';   // 'cur' = החודש הנוכחי, 'prev' = החודש הקודם (בלחיצה על הריבוע שלו)
  const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  /** שורות מידע קטנות: יתרה בעו"ש + חיוב הבא בכאל, וצפי מקארדקום לחודש הבא */
  function finInfoHtml(d) {
    const b = d.balance, f = d.forecast;
    const lines = [];
    if (b) {
      const dt = (x) => `<bdi>${esc(String(x).slice(0, 5))}</bdi>`;
      const amt = (n) => (n == null ? '—' : '₪' + Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      lines.push(`<div class="fin-info">${b.error ? '<span title="העדכון האחרון נכשל – מוצגים הערכים הקודמים">⚠️</span> ' : ''}יתרה בעו״ש <bdi>383842</bdi>: <b>${amt(b.balance)}</b>${b.asOf ? ` (נכון ל-${dt(b.asOf)})` : ''}${b.nextCharge != null ? ` · חיוב הבא בכאל: <b>${amt(b.nextCharge)}</b>${b.chargeDate ? ` ב-${dt(b.chargeDate)}` : ''}` : ''}</div>`);
    }
    if (f) {
      const mName = HEB_MONTHS[(f.month || 1) - 1];
      lines.push(f.total != null && f.items && f.items.length
        ? `<details class="fin-info fin-forecast"><summary>צפוי להיכנס מקארדקום ב${esc(mName)}: <b>₪${Number(f.total).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></summary>
            ${f.items.map((x) => `<div class="fc-row"><bdi>${esc(x.date)}</bdi><b>₪${Number(x.amount).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></div>`).join('')}</details>`
        : `<div class="fin-info">צפוי להיכנס מקארדקום ב${esc(mName)}: אין תחזית כרגע</div>`);
    }
    return lines.join('');
  }

  function renderFinance(d) {
    const mo = d.months || [];
    const isPrev = finView === 'prev' && !!mo[1];
    const cur = isPrev ? mo[1] : mo[0];
    const review = (d.review || []).filter((r) => !decided[r.id]);
    const pre = (t) => `<div class="pre">${esc(t)}</div>`;
    const ml = (isPrev ? d.prevMonth : d.month) || { income: [], expenses: [] };
    const sumOf = (a) => a.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const debts = d.summary && d.summary.debts;
    const debtItems = debts ? (debts.items || []).filter((it) => !it.key || !it.cleared) : [];
    const added = finAdded();
    const anom = d.summary && d.summary.anomalies && d.summary.anomalies.items ? d.summary.anomalies : null;
    const anomItems = anom ? anom.items.filter((it) => !it.cleared) : [];
    shell('פיננסים', `
      <div class="tiles">
        ${mo.map((m, i) => `<button type="button" class="card tile fin-month ${(i === 1) === isPrev ? 'sel' : ''}" data-fm="${i === 1 ? 'prev' : 'cur'}">
          <div class="lbl"><b>${esc(m.label)}</b>${i === 0 ? ' (החודש)' : ' (החודש הקודם)'}</div>
          <div class="fin-line">הכנסות <b>${money(m.income)}</b></div>
          <div class="fin-line">הוצאות <b>${money(m.expenses)}</b></div>
          <div class="fin-line">רווח נטו משוער <b>${money(m.net)}</b></div>
          ${i === 1 && !isPrev ? '<div class="muted small">לדוח המלא ←</div>' : ''}
        </button>`).join('')}
      </div>
      ${isPrev ? `<div class="prev-banner"><span class="grow">מוצג הדוח של <b>${esc(cur.label)}</b></span><button class="btn small" data-fm="cur">← חזרה ל${esc(mo[0].label)}</button></div>` : ''}
      ${finInfoHtml(d)}
      <div class="row" style="align-items:center;margin-top:6px">
        <div class="muted small grow">עדכון פיננסים אחרון: ${esc(d.lastUpdate || '—')}</div>
        <a class="btn small secondary" href="${FIN_TASK_URL}" target="_blank" rel="noopener">🔄 עדכון פיננסים עכשיו</a>
      </div>
      ${isPrev ? `<div class="notice info small" style="margin-top:12px">"לבדיקה", דוח החייבים, החריגים והסיכום השבועי מגיעים מהעדכון השבועי האחרון, ולכן מוצגים בחודש הנוכחי.</div>` : `
      <div class="row" style="margin:14px 0 6px;align-items:center;flex-wrap:wrap;gap:6px">
        <div class="section-title grow" style="margin:0">לבדיקה (${review.length})</div>
        <button class="btn small secondary" data-act="add-income">＋ הכנסה ידנית</button>
        <button class="btn small secondary" data-act="add-expense">＋ הוצאה ידנית</button>
      </div>
      ${added.length ? `<div class="mlist">${added.map((a) => `<div class="card mrow decided"><div class="grow small">נוספה ${a.kind === 'exp' ? 'הוצאה' : 'הכנסה'} ידנית: <b>${esc(a.desc)}</b> · ${money(a.amount)}${a.pending ? ' · שומר…' : ''}</div>${a.pending ? '' : `<button class="btn small ghost" data-unadd="${esc(a.id)}">↶ ביטול</button>`}</div>`).join('')}</div>` : ''}
      ${(d.review || []).length ? `<div class="mlist">${(d.review || []).map((r) => {
        const dc = decided[r.id];
        return `<div class="card tx-row ${dc ? 'decided' : ''}" data-rid="${esc(r.id)}">
          <div class="tx-top"><b class="grow">${esc(r.desc)}</b><b class="ltr-text">₪${esc(r.amount)}</b></div>
          <div class="tx-bottom">
            <span class="muted small grow">${esc(r.date)} · ${esc(r.source)} · ${esc(r.type)}</span>
            ${dc ? `<span class="small">${dc.business ? '✅ עסקי' : '❌ פרטי'}</span><button class="btn small ghost" data-undo>ביטול</button>`
              : '<button class="btn small" data-biz="1">✅ עסקי</button><button class="btn small danger" data-biz="0">❌ פרטי</button>'}
          </div>
        </div>`;
      }).join('')}</div>` : '<div class="card muted">אין תנועות לבדיקה 🎉</div>'}
      ${debts ? `<div class="section-title">🔴 ${esc(debts.title)}</div><div class="card debts">
        ${Object.keys(debtUndo).map((k) => `<div class="debt-row decided"><span class="grow small">נוקה: ${esc(debtUndo[k].name)} · ${money(debtUndo[k].amount)}</span><button class="btn small ghost" data-undebt="${esc(k)}">↶ ביטול</button></div>`).join('')}
        ${debtItems.map((it) => it.head ? `<div class="debt-head">${esc(it.head)}</div>`
          : it.key ? `<div class="debt-row" data-debt="${esc(it.key)}"><span class="grow"><b>${esc(it.name)}</b> · ${money(it.amount)} · ${esc(it.date)}${it.extra ? `<div class="muted small">${esc(it.extra)}</div>` : ''}</span><button class="btn small ghost" data-clear>נקה</button></div>`
          : `<div class="small">${esc(it.text)}</div>`).join('')}
      </div>` : ''}
      ${anom ? `<div class="section-title">⚠️ ${esc(anom.title)}</div><div class="card debts">
        ${Object.keys(anomUndo).map((k) => `<div class="debt-row decided"><span class="grow small">נוקה: ${esc(anomUndo[k].text)}</span><button class="btn small ghost" data-unanom="${esc(k)}">↶ ביטול</button></div>`).join('')}
        ${anomItems.length ? anomItems.map((it) => `<div class="debt-row" data-anom="${esc(it.key)}"><span class="grow small">${esc(it.text)}</span><button class="btn small ghost" data-clear>נקה</button></div>`).join('') : (Object.keys(anomUndo).length ? '' : '<div class="muted small">אין חריגים</div>')}
      </div>` : ''}
      ${d.summary && d.summary.invoices ? `<div class="section-title">🧾 ${esc(d.summary.invoices.title)}</div><div class="card">${pre(d.summary.invoices.body)}</div>` : ''}`}
      <div class="section-title">${isPrev ? esc(cur.label) : 'החודש'}</div>
      ${monthDetails(isPrev ? 'הכנסות ' + cur.label : 'הכנסות החודש', ml.income, sumOf(ml.income), cur ? cur.income : null, true)}
      ${monthDetails(isPrev ? 'הוצאות ' + cur.label : 'הוצאות החודש', ml.expenses, sumOf(ml.expenses), cur ? cur.expenses : null, false)}
      ${!isPrev && d.summary && d.summary.text ? `<details class="card"><summary>הצגת הסיכום המלא${d.summary.at ? ` · ${esc(d.summary.at)}` : ''}</summary>${pre(d.summary.text)}</details>` : ''}
      ${d.year ? `<div class="section-title">השנה</div>
      <div class="card year-card">
        <div class="fin-line">הכנסות שנתיות <b>${money(d.year.income)}</b></div>
        <div class="fin-line">הוצאות שנתיות <b>${money(d.year.expenses)}</b></div>
        <div class="fin-line">רווח נטו שנתי <b>${money(d.year.net)}</b></div>
        <div class="muted small">מ-1 בינואר עד היום</div>
      </div>` : ''}
      ${d.fixed ? `<div class="section-title">נספחים</div>
      <details class="card month-list"><summary>הוצאות קבועות${d.fixed.total ? ` – ₪${esc(d.fixed.total)}` : ''}</summary>
        <table class="mtable"><thead><tr><th>שם</th><th>חודש קודם</th><th>תדירות</th><th>חיוב אחרון</th></tr></thead><tbody>
        ${d.fixed.items.map((x) => `<tr><td>${esc(x.name)}</td><td class="nowrap amt">${x.amount && x.amount !== '-' ? '₪' + esc(x.amount) : '—'}</td><td class="small">${esc(x.freq)}</td><td class="nowrap small">${esc(x.last)}</td></tr>`).join('')}
        ${d.fixed.total ? `<tr class="total"><td><b>סה״כ</b></td><td class="nowrap amt">₪${esc(d.fixed.total)}</td><td></td><td></td></tr>` : ''}
        </tbody></table>
      </details>` : ''}`);
    $app.querySelectorAll('[data-fm]').forEach((b) => {
      b.onclick = () => { const v = b.dataset.fm; if (v === finView) return; finView = v; renderFinance(store.get('finance') || d); window.scrollTo(0, 0); };
    });
    const ai = $app.querySelector('[data-act="add-income"]'); if (ai) ai.onclick = () => openManualTx('inc');
    const ae = $app.querySelector('[data-act="add-expense"]'); if (ae) ae.onclick = () => openManualTx('exp');
    $app.querySelectorAll('[data-rid]').forEach((row) => {
      const r = (d.review || []).find((x) => x.id === row.dataset.rid);
      row.querySelectorAll('[data-biz]').forEach((b) => { b.onclick = () => decideTx(r, b.dataset.biz === '1'); });
      const u = row.querySelector('[data-undo]');
      if (u) u.onclick = () => undoDecide(r);
    });
    $app.querySelectorAll('[data-debt] [data-clear]').forEach((b) => {
      b.onclick = () => clearDebt(debtItems.find((x) => x.key === b.closest('[data-debt]').dataset.debt));
    });
    $app.querySelectorAll('[data-undebt]').forEach((b) => { b.onclick = () => unclearDebt(b.dataset.undebt); });
    $app.querySelectorAll('[data-anom] [data-clear]').forEach((b) => { b.onclick = () => clearAnom(anomItems.find((x) => x.key === b.closest('[data-anom]').dataset.anom), true); });
    $app.querySelectorAll('[data-unanom]').forEach((b) => { b.onclick = () => clearAnom(anomUndo[b.dataset.unanom], false); });
    $app.querySelectorAll('[data-unadd]').forEach((b) => { b.onclick = () => undoManualTx(b.dataset.unadd); });
  }

  function decideTx(r, business) {
    decided[r.id] = { business, pending: true };
    redrawStage2();
    api('finDecide', { id: r.id, business }).then((res) => {
      decided[r.id] = { business, undo: res.undo };
      toast(business ? `✅ עסקי – ${r.desc}` : `❌ פרטי – ${r.desc}`);
      markDerivedStale();
    }).catch((e) => { delete decided[r.id]; redrawStage2(); toast('לא נשמר: ' + e.message, true); });
  }
  function undoDecide(r) {
    const dc = decided[r.id];
    if (!dc || !dc.undo) return toast('רגע, עוד נשמר…');
    delete decided[r.id];
    redrawStage2();
    api('finDecide', { id: r.id, undo: dc.undo }).then(() => { toast('בוטל ✓ – חזר ל"לבדיקה"'); markDerivedStale(); })
      .catch((e) => { decided[r.id] = dc; redrawStage2(); toast('הביטול לא בוצע: ' + e.message, true); });
  }

  const anomUndo = {};   // key → חריג שנוקה (להצגת ↶)
  function clearAnom(it, clear) {
    if (!it) return;
    const set = (v) => patchStore('finance', (dd) => { const x = dd.summary && dd.summary.anomalies && (dd.summary.anomalies.items || []).find((y) => y.key === it.key); if (x) x.cleared = v; });
    if (clear) anomUndo[it.key] = it; else delete anomUndo[it.key];
    set(clear); redrawStage2();
    api('anomClear', { key: it.key, undo: !clear }).then(() => toast(clear ? 'נוקה ✓ – לא יוצג שוב' : '↶ חזר לרשימה'))
      .catch((e) => { if (clear) delete anomUndo[it.key]; else anomUndo[it.key] = it; set(!clear); redrawStage2(); toast('לא נשמר: ' + e.message, true); });
  }
  function setDebtCleared(key, val) {
    patchStore('finance', (dd) => { const it = dd.summary && dd.summary.debts && dd.summary.debts.items.find((x) => x.key === key); if (it) it.cleared = val; });
  }
  function clearDebt(it) {
    if (!it) return;
    debtUndo[it.key] = it; setDebtCleared(it.key, true); redrawStage2();
    api('debtClear', { type: it.type, name: it.name, amount: it.amount, date: it.date }).then(() => toast('נוקה ✓ – לא יופיע שוב בסיכום'))
      .catch((e) => { delete debtUndo[it.key]; setDebtCleared(it.key, false); redrawStage2(); toast('לא נשמר: ' + e.message, true); });
  }
  function unclearDebt(key) {
    const it = debtUndo[key];
    if (!it) return;
    delete debtUndo[key]; setDebtCleared(key, false); redrawStage2();
    api('debtClear', { type: it.type, name: it.name, amount: it.amount, date: it.date, undo: true }).then(() => toast('↶ חזר לדוח'))
      .catch((e) => { debtUndo[key] = it; setDebtCleared(key, true); redrawStage2(); toast('לא בוצע: ' + e.message, true); });
  }

  /** הכנסה / הוצאה ידנית ל"תנועות" */
  function openManualTx(kind) {
    const exp = kind === 'exp';
    const sh = openSheet(`
      <div class="row"><b class="grow">${exp ? 'הוצאה ידנית' : 'הכנסה ידנית'}</b><button class="icon-btn" data-x aria-label="סגירה">✕</button></div>
      <div class="row">
        <div class="field grow"><label for="mt-date">תאריך</label><input id="mt-date" type="date" value="${isoToday()}"></div>
        <div class="field grow"><label for="mt-amount">סכום (₪)</label><input id="mt-amount" type="number" inputmode="decimal" min="1" step="0.01"></div>
      </div>
      <div class="field"><label for="mt-desc">${exp ? 'שם ההוצאה' : 'תיאור'}</label><input id="mt-desc" placeholder="${exp ? 'למשל: צילום סרטונים' : 'למשל: ליווי מאמנים – שם המאמן'}"></div>
      <div class="field"><label for="mt-src">${exp ? 'אמצעי תשלום' : 'מקור'}</label><select id="mt-src">${exp
        ? '<option value="card">כרטיס</option><option value="bank">העברה</option><option value="cash">מזומן</option><option value="bit">ביט</option>'
        : '<option value="bit">ביט</option><option value="bank">העברה בנקאית</option><option value="cash">מזומן</option>'}</select></div>
      ${exp ? '<label class="toggle-row"><input type="checkbox" id="mt-vat"> מע״מ מוכר</label>' : ''}
      <div class="notice small" id="mt-warn" hidden></div>
      <button class="btn" data-save>הוספה ל"תנועות"</button>`);
    const $ = (q) => sh.el.querySelector(q);
    setTimeout(() => $('#mt-amount').focus(), 50);
    $('[data-save]').onclick = () => {
      const f = { date: $('#mt-date').value, amount: $('#mt-amount').value, desc: $('#mt-desc').value.trim() };
      if (exp) { f.method = $('#mt-src').value; f.vat = $('#mt-vat').checked; } else f.source = $('#mt-src').value;
      const warn = $('#mt-warn');
      if (!f.date) { warn.hidden = false; warn.textContent = 'חסר תאריך'; return; }
      if (!(Number(f.amount) > 0)) { warn.hidden = false; warn.textContent = 'סכום לא תקין'; return; }
      if (!f.desc) { warn.hidden = false; warn.textContent = exp ? 'חסר שם הוצאה' : 'חסר תיאור'; return; }
      sh.close();
      const tmp = { id: 'tmp-' + Date.now(), kind, desc: f.desc, amount: Number(f.amount), pending: true };
      store.set('finAdded', finAdded().concat([tmp]));
      // מיד גם ברשימת החודש (אם זה החודש הנוכחי)
      const [y, m, dd] = f.date.split('-');
      const now = new Date();
      const inMonth = Number(y) === now.getFullYear() && Number(m) === now.getMonth() + 1;
      const row = { id: tmp.id, date: `${dd}/${m}/${y}`, day: Number(dd), name: f.desc, amount: Number(f.amount), source: exp ? '' : { bit: 'ביט', bank: 'העברה בנקאית', cash: 'מזומן' }[f.source] };
      if (inMonth) patchStore('finance', (d) => { d.month = d.month || { income: [], expenses: [] }; d.month[exp ? 'expenses' : 'income'].push(row); d.month[exp ? 'expenses' : 'income'].sort((a, b) => a.day - b.day); });
      redrawStage2();
      api(exp ? 'finAddExpense' : 'finAddIncome', f).then((r) => {
        store.set('finAdded', finAdded().map((a) => (a.id === tmp.id ? { id: r.id, kind, desc: r.desc, amount: r.amount } : a)));
        patchStore('finance', (d) => { const it = d.month && d.month[exp ? 'expenses' : 'income'].find((x) => x.id === tmp.id); if (it) it.id = r.id; });
        redrawStage2();
        toast(`✅ נוספה ${exp ? 'הוצאה' : 'הכנסה'} ${money(Number(f.amount))}`);
        markDerivedStale();
      }).catch((e) => {
        store.set('finAdded', finAdded().filter((a) => a.id !== tmp.id));
        patchStore('finance', (d) => { if (d.month) d.month[exp ? 'expenses' : 'income'] = d.month[exp ? 'expenses' : 'income'].filter((x) => x.id !== tmp.id); });
        redrawStage2();
        toast(`ה${exp ? 'הוצאה' : 'הכנסה'} לא נוספה: ` + e.message, true);
      });
    };
  }
  function undoManualTx(id) {
    const a = finAdded().find((x) => x.id === id);
    if (!a || !confirm(`למחוק מ"תנועות" את ${a.kind === 'exp' ? 'ההוצאה' : 'ההכנסה'} "${a.desc}" (${money(a.amount)})?`)) return;
    const snapAdded = finAdded(), snapFin = JSON.stringify(store.get('finance'));
    store.set('finAdded', snapAdded.filter((x) => x.id !== id));
    patchStore('finance', (d) => { if (d.month) ['income', 'expenses'].forEach((k) => { d.month[k] = d.month[k].filter((x) => x.id !== id); }); });
    redrawStage2();
    api('finRemoveManual', { id, desc: a.desc, amount: a.amount }).then(() => { toast('↶ נמחק מ"תנועות"'); markDerivedStale(); })
      .catch((e) => { store.set('finAdded', snapAdded); store.set('finance', JSON.parse(snapFin)); redrawStage2(); toast('לא נמחק: ' + e.message, true); });
  }

  function viewMore() {
    const n = untreatedCount();
    shell('עוד', `<div class="mlist">
      <a class="card mrow more-row" href="#/untreated"><span class="ico">⏰</span><div class="grow"><b>לידים שלא טופלו</b></div>${n ? `<span class="badge">${n}</span>` : ''}</a>
      <a class="card mrow more-row" href="#/ghosting"><span class="ico">👻</span><div class="grow"><b>גוסטינג</b></div></a>
      <a class="card mrow more-row" href="#/month"><span class="ico">💰</span><div class="grow"><b>שכר שי</b></div></a>
      <a class="card mrow more-row" href="#/zooms"><span class="ico">📅</span><div class="grow"><b>זומים לשיוך</b></div>${state.alertsCount ? `<span class="badge">${state.alertsCount}</span>` : ''}</a>
      <a class="card mrow more-row" href="#/notifs"><span class="ico">🔔</span><div class="grow"><b>התראות</b></div>${state.unread ? `<span class="badge">${state.unread}</span>` : ''}</a>
      <a class="card mrow more-row" href="#/settings"><span class="ico">⚙️</span><div class="grow"><b>הגדרות</b></div></a>
    </div>`);
  }

  // ---------- מסך נסתר: בדיקות מערכת ----------
  function viewStatus() {
    if (!isAdmin()) return (location.hash = '#/leads');
    return swr('home', 'home', {}, 'בדיקות מערכת', renderStatus);
  }
  function renderStatus(d) {
    const h = d.health || { issues: [], details: {} };
    const x = h.details || {};
    const ago = (t) => (t ? relTime(t) : 'עוד לא נרשם');
    const z = x.zoomLast;
    shell('בדיקות מערכת', `
      ${h.issues.length ? h.issues.map((i) => `<div class="health-warn">⚠️ ${esc(i)}</div>`).join('') : '<div class="notice info">✅ הכל תקין</div>'}
      <div class="section-title">טריגרים היום</div>
      <div class="card small">
        ${(x.runs || []).map((r) => `<div><b>${esc(r.label)}:</b> ${r.runs} הרצות · ממוצע ${(r.avgMs / 1000).toFixed(1)} שנ׳ · ${r.totalMin} דק׳ · אחרונה ${esc(ago(r.last))}</div>`).join('')}
        <div style="margin-top:6px"><b>סה״כ היום:</b> ${x.usedMin != null ? x.usedMin : '—'} מתוך 90 דק׳${x.prevDay ? ` · אתמול: ${Math.round(x.prevDay.ms / 6000) / 10} דק׳` : ''}</div>
        <div class="muted">בדיקת לידים חדשים: כל ${x.watchMinutes || 1} דק׳ · טריגרים מותקנים: ${esc((x.triggers || []).join(', '))}</div>
      </div>
      <div class="section-title">זומים</div>
      <div class="card small">
        <div>טריגר שינוי ביומן: ${x.calTrigger === 'ok' ? '⚡ פעיל (+ גיבוי כל 10 דק׳)' : esc(x.calTrigger || '')}</div>
        <div>הרשאת כתיבה ליומן: ${x.calendarWrite ? '✅' : '❌'}</div>
        ${z ? `<div>אחרון: ${esc(z.name)}${z.seconds != null ? ` – עודכן תוך ${z.seconds < 120 ? z.seconds + ' שניות' : Math.round(z.seconds / 60) + ' דקות'}` : ''} (${esc(z.via || '')}, התאמה לפי ${esc(z.how || '')})</div>` : ''}
      </div>
      <div class="section-title">Push</div>
      <div class="card small">${x.push ? 'Firebase מוגדר ✅' : 'Firebase לא מוגדר'}</div>`, { back: true });
  }

  // ---------- מרכז התראות ----------
  function applyNotifs(d) {
    state.unread = d.unread || 0;
    updateBadges();
  }
  let notifsFetch = null;
  function refreshNotifs() {
    if (notifsFetch || !state.session) return notifsFetch;
    notifsFetch = api('notifications').then((d) => {
      const before = JSON.stringify(store.get('notifs'));
      store.set('notifs', d); applyNotifs(d);
      if (before !== JSON.stringify(d) && !isEditing()) rerenderNotifPages();
    }).catch(() => {}).finally(() => { notifsFetch = null; });
    return notifsFetch;
  }
  function markNotifsRead(ids, all) {
    const d = store.get('notifs');
    if (d) {
      d.items.forEach((n) => { if (all || ids.includes(n.id)) n.read = true; });
      d.unread = d.items.filter((n) => !n.read).length;
      store.set('notifs', d); applyNotifs(d);
    }
    api('notifRead', all ? { all: true } : { ids }).catch(() => {});
  }
  function relTime(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'עכשיו';
    if (m < 60) return `לפני ${m} דק׳`;
    if (m < 24 * 60) return `לפני ${Math.round(m / 60)} שע׳`;
    return fmtTs(ms);
  }

  function viewNotifs() {
    return swr('notifs', 'notifications', {}, 'התראות', (d) => { applyNotifs(d); renderNotifs(d); });
  }

  function renderNotifs(d) {
    const items = d.items || [];
    shell('התראות', `
      <div class="row" style="margin:4px 0 6px">
        <div class="section-title grow" style="margin:0">התראות אחרונות</div>
        ${d.unread ? '<button class="btn small secondary" data-act="read-all">סימון הכל כנקרא</button>' : ''}
      </div>
      ${items.length ? `<div class="mlist">${items.map((n) => `
        <a class="card mrow notif ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/notifs')}" data-nid="${esc(n.id)}">
          <div class="grow"><b>${esc(n.title)}</b><div>${esc(n.body)}</div></div>
          <span class="muted small">${esc(relTime(n.at))}</span>
        </a>`).join('')}</div>` : '<div class="empty">אין התראות עדיין</div>'}
      <a class="card mrow more-row" href="#/settings" style="margin-top:14px"><span class="ico">⚙️</span><div class="grow"><b>הגדרות התראות</b><div class="muted small">התראות לטלפון ואילו סוגים לקבל</div></div></a>`);
    $app.querySelectorAll('[data-nid]').forEach((a) => {
      a.addEventListener('click', () => { const n = items.find((x) => x.id === a.dataset.nid); if (n && !n.read) markNotifsRead([n.id]); });
    });
    const ra = $app.querySelector('[data-act="read-all"]');
    if (ra) ra.onclick = () => { markNotifsRead([], true); renderNotifs(store.get('notifs')); };
  }

  function viewSettings() {
    return swr('notifs', 'notifications', {}, 'הגדרות', (d) => { applyNotifs(d); renderSettings(d); });
  }
  function renderSettings(d) {
    shell('הגדרות', `
      ${pushCardHtml(d)}
      <div class="section-title">אילו התראות לקבל</div>
      <div class="card">
        ${(d.types || []).map((t) => `<label class="toggle-row"><input type="checkbox" data-type="${esc(t.k)}" ${d.settings[t.k] ? 'checked' : ''}> ${esc(t.icon)} ${esc(t.label)}</label>`).join('')}
        <div class="muted small">מה שמכובה – לא יופיע בפעמון ולא יגיע לטלפון.</div>
        ${isAdmin() && !state.viewAs ? '<div class="muted small" style="margin-top:6px">💳 📊 🏁 בשעות 23:00–07:00 נשמרים בפעמון ונשלחים לטלפון ב-07:00 (מאוחד). ⚠️ ביטול מאוחר – תמיד מיד.</div>' : ''}
      </div>
      ${isAdmin() && !state.viewAs ? '<button class="btn secondary" data-act="notify-test" style="margin-top:12px;width:100%">🧪 שליחת התראות בדיקה (4 הסוגים)</button>' : ''}`, { back: true });
    const nt = $app.querySelector('[data-act="notify-test"]');
    if (nt) nt.onclick = () => {
      nt.disabled = true;
      api('notifyTest').then((r) => { toast('✅ ' + r.message); refreshNotifs(); })
        .catch((e) => toast(e.message, true)).finally(() => { nt.disabled = false; });
    };
    $app.querySelectorAll('[data-type]').forEach((c) => {
      c.onchange = () => {
        const cur = store.get('notifs');
        if (cur) { cur.settings[c.dataset.type] = c.checked; store.set('notifs', cur); }
        api('notifSettings', { settings: { [c.dataset.type]: c.checked } })
          .then(() => toast('נשמר ✓'))
          .catch((e) => { c.checked = !c.checked; toast('לא נשמר: ' + e.message, true); });
      };
    });
    bindPushCard(d);
  }
  function rerenderNotifPages() {
    const d = store.get('notifs') || { items: [], types: [], settings: {} };
    if (location.hash === '#/settings') renderSettings(d);
    else if (location.hash === '#/notifs') renderNotifs(d);
  }

  // ---------- Push לטלפון (Firebase Cloud Messaging) ----------
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const firebaseReady = () => !!(CFG.firebase && CFG.firebase.projectId && CFG.vapidKey);

  function pushState() {
    if (!firebaseReady()) return 'not-configured';
    if (isIOS && !isStandalone()) return 'ios-home';
    if (!pushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && LS.get('lf_push_token')) return 'on';
    return 'off';
  }

  function pushCardHtml(d) {
    const st = pushState();
    const iosHelp = `<ol class="small steps">
        <li>פתחו את האפליקציה ב-<b>Safari</b> (לא בכרום ולא מתוך וואטסאפ).</li>
        <li>לחצו על כפתור השיתוף <b>⬆️</b> בתחתית המסך.</li>
        <li>גללו ובחרו <b>"הוספה למסך הבית"</b> ← <b>"הוספה"</b>.</li>
        <li>סגרו את Safari, פתחו את האפליקציה <b>מהאייקון במסך הבית</b>, וחזרו למסך הזה.</li>
      </ol><div class="muted small">באייפון אפל מאפשרת התראות לאתר רק כשהוא מותקן במסך הבית (iOS 16.4 ומעלה).</div>`;
    const body = {
      'not-configured': `<div class="muted small">ההתראות לטלפון עוד לא הוגדרו (Firebase). בינתיים ההתראות מופיעות כאן, בפעמון 🔔.</div>`,
      'ios-home': `<div>כדי לקבל התראות באייפון צריך קודם להוסיף את האפליקציה למסך הבית:</div>${iosHelp}`,
      unsupported: `<div class="muted small">הדפדפן הזה לא תומך בהתראות. ההתראות יופיעו כאן, בפעמון 🔔.</div>`,
      denied: `<div>ההתראות חסומות בטלפון הזה.</div><div class="muted small">${isIOS ? 'כדי לפתוח: הגדרות האייפון ← התראות ← "צוות ליאל פיטנס" ← לאפשר התראות.' : 'כדי לפתוח: לחצו על סמל המנעול ליד הכתובת ← התראות ← לאפשר, ורעננו.'}</div>`,
      on: `<div>✅ התראות פעילות בטלפון הזה</div>
        <div class="row" style="margin-top:8px"><button class="btn small secondary" data-act="push-test">שליחת התראת בדיקה</button><button class="btn small ghost" data-act="push-off">כיבוי בטלפון הזה</button></div>`,
      off: `<div class="muted small">קבלו התראה לטלפון גם כשהאפליקציה סגורה.</div>
        <button class="btn" data-act="push-on" style="margin-top:8px">🔔 הפעלת התראות בטלפון הזה</button>
        ${isIOS ? '' : '<div class="muted small" style="margin-top:6px">באייפון: צריך קודם להוסיף את האפליקציה למסך הבית מ-Safari.</div>'}`,
    }[st];
    return `<div class="card push-card"><b>התראות לטלפון</b>${body}</div>`;
  }

  function bindPushCard() {
    const on = $app.querySelector('[data-act="push-on"]');
    if (on) on.onclick = () => enablePush(on);
    const t = $app.querySelector('[data-act="push-test"]');
    if (t) t.onclick = () => {
      t.disabled = true;
      api('pushTest').then((r) => toast(r.sent ? 'נשלחה התראת בדיקה ✓' : (r.message || 'לא נשלח'), !r.sent))
        .catch((e) => toast(e.message, true)).finally(() => { t.disabled = false; });
    };
    const off = $app.querySelector('[data-act="push-off"]');
    if (off) off.onclick = () => {
      const token = LS.get('lf_push_token');
      LS.del('lf_push_token');
      if (token) api('pushUnregister', { token }).catch(() => {});
      toast('ההתראות לטלפון הזה כובו');
      rerenderNotifPages();
    };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('טעינה נכשלה'));
      document.head.appendChild(s);
    });
  }
  const FB_VER = '10.12.2';
  async function fcmToken() {
    await loadScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-messaging-compat.js`);
    if (!window.firebase.apps.length) window.firebase.initializeApp(CFG.firebase);
    const reg = await navigator.serviceWorker.ready;
    return window.firebase.messaging().getToken({ vapidKey: CFG.vapidKey, serviceWorkerRegistration: reg });
  }
  function deviceName() {
    const ua = navigator.userAgent;
    return (isIOS ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'דפדפן') + (isStandalone() ? ' (מסך הבית)' : '');
  }

  async function enablePush(btn) {
    if (state.viewAs) return toast('חזרו לתצוגה שלכם כדי להפעיל התראות', true);
    btn.disabled = true; btn.textContent = 'מפעיל…';
    try {
      // חייב להיות ישר מהלחיצה (באייפון אחרת החלון לא נפתח)
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('לא אושרו התראות', true); rerenderNotifPages(); return; }
      const token = await fcmToken();
      if (!token) throw new Error('לא התקבל מזהה מכשיר');
      await api('pushRegister', { token, device: deviceName(), oldToken: LS.get('lf_push_token') || '' });
      LS.set('lf_push_token', token); LS.set('lf_push_checked', String(Date.now()));
      toast('✅ ההתראות הופעלו');
      api('pushTest').catch(() => {});
    } catch (e) {
      toast('לא הצלחתי להפעיל התראות: ' + e.message, true);
    }
    rerenderNotifPages();
  }

  /** פעם ביום: מוודא שהמזהה של הטלפון עדיין בתוקף (גוגל מחליפה אותו מדי פעם) */
  function refreshPushToken() {
    if (pushState() !== 'on' || state.viewAs) return;
    if (Date.now() - Number(LS.get('lf_push_checked') || 0) < 864e5) return;
    fcmToken().then((token) => {
      LS.set('lf_push_checked', String(Date.now()));
      if (token && token !== LS.get('lf_push_token')) {
        return api('pushRegister', { token, device: deviceName(), oldToken: LS.get('lf_push_token') || '' }).then(() => LS.set('lf_push_token', token));
      }
    }).catch(() => {});
  }

  // לחיצה על התראה: ה-service worker מבקש לפתוח מסך / ההתראות התעדכנו
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'notif') refreshNotifs();
      if (m.type === 'open') { if (m.id) markNotifsRead([m.id]); if (m.link) location.hash = m.link.replace(/^.*#/, '#'); }
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
    if (page === 'notifs') return viewNotifs();
    if (page === 'status') return viewStatus();
    if (isAdmin()) {
      if (page === 'coaches') { if (parts[1] === 'low' || parts[1] === 'done') coachFilter = parts[1]; return viewCoaches(); }
      if (page === 'coach' && parts[1]) return viewCoach(decodeURIComponent(parts[1]));
      if (page === 'finance') {
        if (parts[1] === 'debts') { finView = 'cur'; const go = () => { const el = $app.querySelector('.debts'); if (el) el.scrollIntoView({ block: 'start' }); }; const r = viewFinance(); setTimeout(go, 60); return r; }
        return viewFinance();
      }
      if (page === 'more') return viewMore();
      if (page === 'settings') return viewSettings();
    }
    location.replace(isAdmin() ? '#/home' : '#/leads');
  }

  function applyMe(me) {
    state.role = me.role; state.realRole = me.realRole || me.role;
    state.email = me.email; state.bookingUrl = me.bookingUrl; state.bookingEmbedUrl = me.bookingEmbedUrl || '';
    if (me.undoCount != null) state.undoCount = me.undoCount;
    if (me.redoCount != null) state.redoCount = me.redoCount;
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
    const openedFrom = new URLSearchParams(location.search).get('n');
    if (openedFrom) history.replaceState(null, '', location.pathname + location.hash);
    route();
    refreshAlerts();
    const nc = store.get('notifs'); if (nc) applyNotifs(nc);
    refreshNotifs().then(() => { if (openedFrom && openedFrom !== 'test') markNotifsRead([openedFrom]); });
    setInterval(() => { if (document.visibilityState === 'visible') refreshNotifs(); }, 60000);
    setTimeout(refreshPushToken, 5000);
    setTimeout(() => prefetchAll(false), 400);
    // רענון ברקע כשחוזרים לאפליקציה
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.session) {
        if (pendingBooking && Date.now() - pendingBooking.at < 30 * 60000) { watchBooking(pendingBooking.lead); pendingBooking = null; }
        refreshAlerts(); refreshNotifs(); softRefresh();
        setTimeout(() => prefetchAll(false), 1500);
      }
    });
    // Ctrl+Z / Ctrl+Y (כשלא מקלידים בשדה)
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || isEditing()) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoLast(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redoLast(); }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  boot();
})();
