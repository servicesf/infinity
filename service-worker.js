const STATIC_CACHE = 'infinit-panel-v1';
const STATIC_ASSETS = [
  '/admin.html',
  '/admin.css?v=12',
  '/admin.js?v=14',
  '/imagenes/favicon-infinit.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== STATIC_CACHE).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || 'Infinit', {
    body: data.body || 'Tienes un comprobante pendiente por revisar.',
    icon: '/imagenes/favicon-infinit.svg',
    badge: '/imagenes/favicon-infinit.svg',
    tag: 'infinit-receipt',
    renotify: true,
    data: { url: data.url || '/admin.html#receiptInbox' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/admin.html#receiptInbox';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => new URL(client.url).pathname === '/admin.html');
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
