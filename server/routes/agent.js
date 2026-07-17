import express from 'express';
import * as mock from '../wxcc/mockProvider.js';
import * as live from '../wxcc/liveProvider.js';
import { getDashboard, getActiveCall, getCallHistory, checkExistingSession } from '../wxcc/dashboard.js';
import { clearTokenCookie } from '../session.js';

const router = express.Router();

function providerFor(session) {
  return session.mode === 'live' ? live : mock;
}

router.post('/login', async (req, res) => {
  const { mode = 'mock', name, dialNumber, teamId, teamName } = req.body || {};
  req.session.mode = mode;
  try {
    const provider = providerFor(req.session);
    const data =
      mode === 'live'
        ? await provider.login(req.session, { dialNumber, teamId, teamName })
        : provider.login(req.session, { name });
    let notificationsError = null;
    let presenceError = null;
    if (mode === 'live') {
      // A failed WebSocket subscribe shouldn't strand the agent on the login screen --
      // they're already logged in on WxCC's side by this point. Surface it as a warning.
      try {
        await live.subscribeNotifications(req.session);
      } catch (err) {
        notificationsError = err.message;
      }
      // Land in the org's configured default idle reason (e.g. "Login") instead of
      // assuming Available -- matches how the real desktop behaves post-login.
      try {
        const defaultIdle = await live.getDefaultIdleCode(req.session);
        if (defaultIdle) {
          await live.setState(req.session, 'Idle', { auxCodeId: defaultIdle.id, reason: defaultIdle.name });
        }
      } catch (err) {
        presenceError = err.message;
      }
    }
    res.json({
      ok: true,
      profile: req.session.profile,
      agentState: req.session.agentState,
      data,
      notificationsError,
      presenceError,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await providerFor(req.session).logout(req.session);
  } catch {
    // Non-fatal: sign-out should always land back on the main page, even if the real
    // WxCC logout call fails (e.g. the agent never actually finished logging in yet).
  }
  // Fully reset -- otherwise mode/tokens/cached identity would survive a reload and
  // the app would land back on the team screen instead of the actual main page.
  req.session.mode = null;
  req.session.tokens = null;
  req.session.tokensIssuedAt = 0;
  req.session.agentContext = null;
  req.session.agentProfileData = null;
  req.session.wxccOrgId = null;
  req.session.wxccCiUserId = null;
  clearTokenCookie(res);
  res.json({ ok: true });
});

router.post('/state', async (req, res) => {
  const { state, auxCodeId, reason } = req.body || {};
  try {
    const data = await providerFor(req.session).setState(req.session, state, { auxCodeId, reason });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/active-call', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, call: null });
  try {
    const call = await getActiveCall(req.session);
    res.json({ ok: true, call });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/call-log', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, calls: [] });
  try {
    const calls = await getCallHistory(req.session);
    res.json({ ok: true, calls });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/existing-session', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, alreadyLoggedIn: false });
  try {
    const existing = await checkExistingSession(req.session);
    if (!existing) return res.json({ ok: true, alreadyLoggedIn: false });
    const dialNumber = await live.getDefaultDialNumber(req.session);
    req.session.profile = { teamId: existing.teamId, teamName: existing.teamName, dialNumber };
    if (existing.state === 'available') {
      req.session.agentState = 'Available';
    } else if (existing.state === 'idle') {
      req.session.agentState = `Idle: ${existing.idleCode || existing.stateLabel}`;
    } else {
      req.session.agentState = existing.stateLabel;
    }
    res.json({ ok: true, alreadyLoggedIn: true, profile: req.session.profile, agentState: req.session.agentState });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/me', (req, res) => {
  res.json({
    mode: req.session.mode,
    profile: req.session.profile,
    agentState: req.session.agentState,
    currentTask: req.session.currentTask,
  });
});

router.get('/dashboard', async (req, res) => {
  if (req.session.mode !== 'live') return res.status(400).json({ ok: false, error: 'Live mode only' });
  try {
    const dashboard = await getDashboard(req.session);
    res.json({ ok: true, ...dashboard });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/teams', async (req, res) => {
  if (req.session.mode !== 'live') {
    return res.status(400).json({ ok: false, error: 'Team lookup is only available in live mode' });
  }
  try {
    const teams = await live.listTeams(req.session);
    const defaultDialNumber = await live.getDefaultDialNumber(req.session);
    res.json({ ok: true, teams, defaultDialNumber });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/idle-codes', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, codes: [] });
  try {
    const codes = await live.getIdleCodes(req.session);
    res.json({ ok: true, codes });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/wrapup-codes', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, codes: [], autoWrapAfterMs: 0 });
  try {
    const [codes, { autoWrapAfterMs }] = await Promise.all([
      live.getWrapUpCodes(req.session),
      live.getWrapUpSettings(req.session),
    ]);
    res.json({ ok: true, codes, autoWrapAfterMs });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/simulate-task', (req, res) => {
  try {
    const task = mock.simulateIncomingTask(req.session);
    res.json({ ok: true, task });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/answer', async (req, res) => {
  try {
    const data = await providerFor(req.session).answerTask(req.session, req.params.id);
    res.json({ ok: true, task: data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/end', async (req, res) => {
  try {
    const data = await providerFor(req.session).endTask(req.session, req.params.id);
    res.json({ ok: true, task: data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/wrapup', async (req, res) => {
  const { auxCodeId, wrapUpReason } = req.body || {};
  try {
    const data = await providerFor(req.session).wrapupTask(req.session, req.params.id, { auxCodeId, wrapUpReason });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const eventNames = ['task:offered', 'task:connected', 'task:ended', 'task:wrapup-complete'];
  const listeners = eventNames.map((name) => {
    const handler = (payload) => send(name, payload);
    req.session.emitter.on(name, handler);
    return { name, handler };
  });

  send('ready', { agentState: req.session.agentState });
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    listeners.forEach(({ name, handler }) => req.session.emitter.off(name, handler));
  });
});

export default router;
