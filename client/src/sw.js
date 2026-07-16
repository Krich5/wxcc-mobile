import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
