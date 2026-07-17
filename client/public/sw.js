// Hand-written service worker (no build step, no workbox) — kept intentionally simple:
// a basic offline app-shell cache plus push notification handling.
//
// Navigations and the manifest go network-first: an agent app must never get stuck
// showing yesterday's build just because it's cache-first. Hashed static assets
// (/assets/*, /icons/*) are safe to cache-first since their filename changes on
// every change.
const CACHE_NAME = 'wxcc-agent-shell-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate' || url.pathname === '/manifest.webmanifest';

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
    )
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'WxCC Agent', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'WxCC Agent';
  const options = {
    body: data.body || 'You have a new task',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    tag: 'wxcc-incoming-task',
    renotify: true,
    data: { taskId: data.taskId },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const client = clientsArr[0];
      if (client) {
        client.focus();
        client.postMessage({ type: 'notification-click', taskId: event.notification.data?.taskId });
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
