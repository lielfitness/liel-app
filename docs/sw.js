// Service worker: רשת קודם (כדי שעדכונים יופיעו מיד), מטמון רק כגיבוי לקבצי האתר.
// לא נוגע בקריאות ל-API (POST) ולא בגוגל. מציג גם התראות Push (Firebase שולח, אנחנו מציגים).
const CACHE = 'lf-shell-v48';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});

// ---------- התראות ----------
// Firebase מעביר את ההודעה כ-{ data: { id, type, title, body, link } }. חייבים להציג התראה בכל push (דרישה של אפל).
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { p = {}; }
  const d = p.data || p || {};
  const n = p.notification || {};
  const title = d.title || n.title || 'צוות ליאל פיטנס';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: d.body || n.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: d.id || undefined,
      data: { id: d.id || '', link: d.link || '' },
      dir: 'rtl', lang: 'he',
    }),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((cs) => cs.forEach((c) => c.postMessage({ type: 'notif' }))),
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const link = data.link && data.link.charAt(0) === '#' ? data.link : '#/notifs';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.indexOf(self.registration.scope) === 0);
    if (c) {
      c.postMessage({ type: 'open', id: data.id, link });
      return c.focus();
    }
    return self.clients.openWindow(self.registration.scope + '?n=' + encodeURIComponent(data.id || '') + link);
  }));
});
