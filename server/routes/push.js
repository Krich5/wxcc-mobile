import express from 'express';
import webpush from 'web-push';

const router = express.Router();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:demo@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

router.get('/public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/subscribe', (req, res) => {
  req.session.pushSubscriptions.push(req.body);
  res.json({ ok: true });
});

router.post('/simulate-incoming-call', async (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(400).json({ ok: false, error: 'VAPID keys are not configured on the server' });
  }
  const payload = JSON.stringify({
    title: 'Incoming task',
    body: 'A caller from Support Queue is waiting',
    taskId: `demo-${req.session.id}`,
  });
  const results = await Promise.allSettled(
    req.session.pushSubscriptions.map((sub) => webpush.sendNotification(sub, payload))
  );
  res.json({ ok: true, sent: results.filter((r) => r.status === 'fulfilled').length });
});

export default router;
