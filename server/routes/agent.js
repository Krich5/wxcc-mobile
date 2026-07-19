import express from 'express';
import * as mock from '../wxcc/mockProvider.js';
import * as live from '../wxcc/liveProvider.js';
import {
  getDashboard,
  getActiveCall,
  getCallHistory,
  checkExistingSession,
  rememberMySessionId,
  isMySessionStillActive,
  findWrapUpTask,
} from '../wxcc/dashboard.js';
import { clearTokenCookie } from '../session.js';
import { revokeWebexTokens } from './auth.js';

const router = express.Router();

function providerFor(session) {
  return session.mode === 'live' ? live : mock;
}

router.post('/login', async (req, res) => {
  const { mode = 'mock', name, dialNumber, teamId, teamName } = req.body || {};
  req.session.mode = mode;
  try {
    const provider = providerFor(req.session);
    // Confirmed live: re-submitting login (Profile Settings' "edit your number and
    // resign in") while already logged in does NOT actually re-register the new dial
    // number on WxCC's side -- the agent's extension in Analyzer stayed the old one, and
    // calls kept routing there. A real logout first (WxCC-level only -- this is NOT the
    // full /api/agent/logout, which also revokes the Webex OAuth session) is what
    // actually clears the old registration so the following login takes.
    if (mode === 'live' && req.session.profile) {
      await provider.logout(req.session).catch(() => {});
    }
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
      // Best-effort, non-fatal: captures which agentSession row is THIS device's while
      // there's no conflict yet to make that ambiguous -- see isMySessionStillActive().
      try {
        await rememberMySessionId(req.session);
      } catch {
        // best-effort
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
  // Revoke the actual Webex OAuth token (not just forget it locally) BEFORE clearing
  // req.session.tokens below -- otherwise sign-out only ever cleared our own cookie,
  // leaving the token itself (and the underlying Webex sign-in) still fully valid.
  await revokeWebexTokens(req.session);
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

router.get('/wrapup-task', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, taskId: null });
  try {
    const taskId = await findWrapUpTask(req.session);
    res.json({ ok: true, taskId });
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

router.post('/consult-agents', async (req, res) => {
  // POST (not GET) since this triggers a real, non-idempotent WxCC request
  // (/v1/agents/buddyList) each time -- not just reading cached data.
  if (req.session.mode !== 'live') return res.json({ ok: true, agents: [] });
  const { state } = req.body || {};
  try {
    const result = await live.getBuddyAgents(req.session, { state });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/address-book', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, entries: [] });
  try {
    const entries = await live.getAddressBookEntries(req.session);
    res.json({ ok: true, entries });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/entry-points', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, entryPoints: [] });
  try {
    const entryPoints = await live.getEntryPoints(req.session);
    res.json({ ok: true, entryPoints });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/outdial-anis', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, anis: [] });
  try {
    const anis = await live.getOutdialAnis(req.session);
    res.json({ ok: true, anis });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/existing-session', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, alreadyLoggedIn: false });
  try {
    // If we already know which agentSessionId is ours, this call is almost certainly the
    // periodic reality-check (SessionContext's poll), not the initial bootstrap --
    // checkExistingSession() below matches purely on agentId, so once a DIFFERENT device
    // logs in as this same agent, it would happily start reporting THAT session as "still
    // logged in" (WxCC's own "Multiple Sign In" takeover). Checking our own remembered
    // agentSessionId specifically is the only way to catch a takeover instead of just
    // re-confirming someone (anyone) is currently logged in as this agent.
    if (req.session.wxccAgentSessionId) {
      const stillMine = await isMySessionStillActive(req.session);
      if (!stillMine) return res.json({ ok: true, alreadyLoggedIn: false });
    }
    const existing = await checkExistingSession(req.session);
    if (!existing) return res.json({ ok: true, alreadyLoggedIn: false });
    const dialNumber = await live.getDefaultDialNumber(req.session);
    req.session.profile = { teamId: existing.teamId, teamName: existing.teamName, dialNumber };
    if (!req.session.wxccAgentSessionId && existing.agentSessionId) {
      req.session.wxccAgentSessionId = existing.agentSessionId;
    }
    if (existing.state === 'available') {
      req.session.agentState = 'Available';
    } else if (existing.state === 'idle') {
      req.session.agentState = `Idle: ${existing.idleCode || existing.stateLabel}`;
    } else {
      req.session.agentState = existing.stateLabel;
    }
    // This path is exactly when the socket is most likely missing (a server restart
    // wiped session.liveSocket, which is why session.profile needed re-detecting here in
    // the first place) -- re-establish it now rather than waiting for something that
    // needs it (e.g. the buddy-list lookup) to fail first. Non-fatal: the agent is
    // already confirmed logged in on WxCC's side regardless of whether this succeeds.
    try {
      await live.ensureNotificationSocket(req.session);
    } catch {
      // best-effort
    }
    res.json({ ok: true, alreadyLoggedIn: true, profile: req.session.profile, agentState: req.session.agentState });
  } catch (err) {
    // A failure here silently degrades to the team/dial-number picker client-side --
    // log it so that degradation is visible in Railway logs instead of looking like
    // "already-logged-in detection just isn't working" with no clue why.
    console.error('[existing-session] check failed:', err.message);
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

router.get('/desktop-branding', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, appTitle: null, logo: null });
  try {
    const branding = await live.getDesktopBranding(req.session);
    res.json({ ok: true, appTitle: branding?.appTitle || null, logo: branding?.logo || null });
  } catch (err) {
    // Purely cosmetic (header title/logo) -- never surface this as an error toast, just
    // log it and fall back to the app's own defaults client-side.
    console.error('[desktop-branding] failed:', err.message);
    res.json({ ok: true, appTitle: null, logo: null });
  }
});

router.get('/identity', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, displayName: null, avatar: null });
  try {
    const identity = await live.getWebexIdentity(req.session);
    res.json({ ok: true, ...identity });
  } catch (err) {
    // Purely cosmetic (hamburger menu header) -- never surface this as an error toast.
    console.error('[identity] failed:', err.message);
    res.json({ ok: true, displayName: null, avatar: null });
  }
});

router.get('/idle-codes', async (req, res) => {
  if (req.session.mode !== 'live') return res.json({ ok: true, codes: [] });
  try {
    const codes = await live.getIdleCodes(req.session);
    res.json({ ok: true, codes });
  } catch (err) {
    // Logged (unlike most other routes) because this has no fallback path the way
    // listTeams does -- idle codes are inherently tied to this agent's specific
    // agent-profile, so there's no org-wide list to fall back to. The client retries a
    // couple of times on its own, but if it's still failing, this is the only place
    // that says why.
    console.error('[idle-codes] failed:', err.message);
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

router.post('/outdial', async (req, res) => {
  const { destination, ani } = req.body || {};
  if (!destination) return res.status(400).json({ ok: false, error: 'Destination is required' });
  try {
    // Unlike the inbound flow, ActiveCall doesn't need this task pushed into
    // session.currentTask -- useActiveCall's own poll (getActiveCall, via taskDetails)
    // picks up any active task owned by this agent regardless of how it started, the
    // same way it already does for calls answered through the inbound flow.
    const task = await providerFor(req.session).startOutdial(req.session, { destination, ani });
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

router.post('/tasks/:id/hold', async (req, res) => {
  try {
    const data = await providerFor(req.session).holdTask(req.session, req.params.id);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/unhold', async (req, res) => {
  try {
    const data = await providerFor(req.session).unholdTask(req.session, req.params.id);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/record/pause', async (req, res) => {
  try {
    const data = await providerFor(req.session).pauseRecording(req.session, req.params.id);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/record/resume', async (req, res) => {
  try {
    const data = await providerFor(req.session).resumeRecording(req.session, req.params.id);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/consult', async (req, res) => {
  const { to, destinationType } = req.body || {};
  if (!to) return res.status(400).json({ ok: false, error: 'Destination is required' });
  try {
    const data = await providerFor(req.session).consultTask(req.session, req.params.id, to, destinationType);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/transfer', async (req, res) => {
  const { to, destinationType } = req.body || {};
  if (!to) return res.status(400).json({ ok: false, error: 'Destination is required' });
  try {
    const data = await providerFor(req.session).transferTask(req.session, req.params.id, to, destinationType);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/consult/transfer', async (req, res) => {
  const { to, destinationType } = req.body || {};
  if (!to) return res.status(400).json({ ok: false, error: 'Destination is required' });
  try {
    const data = await providerFor(req.session).consultTransfer(req.session, req.params.id, to, destinationType);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/consult/end', async (req, res) => {
  try {
    const data = await providerFor(req.session).consultEnd(req.session, req.params.id);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/consult/conference', async (req, res) => {
  const { to, destinationType } = req.body || {};
  if (!to) return res.status(400).json({ ok: false, error: 'Destination is required' });
  try {
    const data = await providerFor(req.session).consultConference(req.session, req.params.id, to, destinationType);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.post('/tasks/:id/wrapup', async (req, res) => {
  const { auxCodeId, wrapUpReason } = req.body || {};
  try {
    const provider = providerFor(req.session);
    const data = await provider.wrapupTask(req.session, req.params.id, { auxCodeId, wrapUpReason });
    // Real WxCC behavior: the agent should be ready for the next call right after
    // wrap-up, not left in whatever idle/wrap-up state they were in before the call --
    // non-fatal if this fails, wrap-up itself already succeeded.
    let presenceError = null;
    try {
      await provider.setState(req.session, 'Available');
    } catch (err) {
      presenceError = err.message;
    }
    res.json({ ok: true, ...data, presenceError });
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
