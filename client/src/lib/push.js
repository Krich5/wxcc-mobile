function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export async function enableNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (isIos() && !isStandalone()) {
      throw new Error(
        'iOS only supports push notifications for an installed app -- tap Share, then "Add to Home Screen", then open it from there and try again'
      );
    }
    throw new Error('Push notifications are not supported on this browser/device');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');

  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await fetch('/api/push/public-key').then((r) => r.json());
  if (!publicKey) throw new Error('Server has no VAPID key configured (see .env.example)');

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
}
