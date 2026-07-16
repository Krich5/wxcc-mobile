// Best-effort integration against the real Webex Contact Center Agent REST/WebSocket
// APIs (https://developer.webex-cx.com). Endpoint paths and payload shapes below are
// drawn from public Cisco blog posts and starter samples, NOT a verified Postman
// collection -- confirm every path/field against your own authenticated
// developer.webex-cx.com account (requires a WxCC-licensed org) before relying on this
// beyond the POC. Each TODO marks a spot to double check.
import WebSocket from 'ws';

function baseUrl() {
  const url = process.env.WXCC_API_BASE_URL;
  if (!url) throw new Error('WXCC_API_BASE_URL is not configured');
  return url;
}

async function authedFetch(session, path, opts = {}) {
  if (!session.tokens?.access_token) {
    throw new Error('Not connected to Webex Contact Center (no access token) - use /api/auth/login first');
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.tokens.access_token}`,
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WxCC API ${path} failed: ${res.status} ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function listTeams(session) {
  // Confirmed against developer.webex.com/webex-contact-center/docs/api/v1/team/list-teams
  // (GET /organization/{orgid}/v2/team). Some WxCC-only Integrations (created with just
  // cjp:*/cjds:*/analytics:* scopes, no spark:*) can't call the generic Webex people/me
  // endpoint to resolve orgId, so this takes the org ID from config instead of trying to
  // filter by the signed-in user -- it lists every team in the org rather than just the
  // agent's own teams.
  const orgId = process.env.WXCC_ORG_ID;
  if (!orgId) throw new Error('WXCC_ORG_ID is not configured');
  const data = await authedFetch(session, `/organization/${orgId}/v2/team`);
  return (data?.data || []).map((team) => ({ id: team.id, name: team.name || team.id }));
}

export async function login(session, { dialNumber, teamId, deviceType = 'BROWSER' }) {
  // TODO verify path/body against POST /v1/agents/login in your Postman collection.
  const data = await authedFetch(session, '/v1/agents/login', {
    method: 'POST',
    body: JSON.stringify({ dialNumber, teamId, isExtension: false, roles: ['agent'], deviceType }),
  });
  session.agentState = 'Available';
  session.profile = { ...(data?.agent || {}), teamId, dialNumber };
  return data;
}

export async function logout(session, { reasonCode = 'AgentLogout' } = {}) {
  // TODO verify path/body against POST /v1/agents/logout.
  const data = await authedFetch(session, '/v1/agents/logout', {
    method: 'POST',
    body: JSON.stringify({ logoutReason: reasonCode }),
  });
  session.agentState = 'Offline';
  if (session.liveSocket) {
    session.liveSocket.close();
    session.liveSocket = null;
  }
  return data;
}

export async function setState(session, state, auxCodeId) {
  // TODO verify path/body against POST /v1/agents/state (Available/Idle + Auxiliary Code).
  const data = await authedFetch(session, '/v1/agents/state', {
    method: 'POST',
    body: JSON.stringify({ state, auxCodeId }),
  });
  session.agentState = state;
  return data;
}

export async function answerTask(session, taskId) {
  // TODO verify against the Call Control REST APIs (accept/answer contact).
  const data = await authedFetch(session, `/v1/agents/contact/${taskId}/accept`, { method: 'POST' });
  if (session.currentTask?.id === taskId) session.currentTask.status = 'connected';
  return data;
}

export async function endTask(session, taskId) {
  // TODO verify against the Call Control REST APIs (end contact).
  const data = await authedFetch(session, `/v1/agents/contact/${taskId}/end`, { method: 'POST' });
  if (session.currentTask?.id === taskId) session.currentTask.status = 'wrapup';
  return data;
}

export async function wrapupTask(session, taskId, code) {
  // TODO verify wrap-up-code submission endpoint/field names.
  const data = await authedFetch(session, `/v1/agents/contact/${taskId}/wrapup`, {
    method: 'POST',
    body: JSON.stringify({ wrapUpCode: code }),
  });
  session.currentTask = null;
  return data;
}

export async function subscribeNotifications(session) {
  // TODO verify against "Register WebSocket Subscription" in the Agent Postman
  // collection -- response field name for the socket URL and the event/type names
  // used for a newly-offered contact are best-effort placeholders here.
  const sub = await authedFetch(session, '/v1/notification/subscribe', {
    method: 'POST',
    body: JSON.stringify({ isKeepAliveEnabled: true, keepAliveInterval: 30 }),
  });
  if (!sub?.websocketUrl) {
    throw new Error('Notification subscribe response did not include a websocketUrl');
  }
  const ws = new WebSocket(sub.websocketUrl);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    session.emitter.emit('raw-notification', msg);
    if (msg?.type === 'AgentContactEvent' && msg?.eventType === 'ContactOffered') {
      session.currentTask = msg.data;
      session.emitter.emit('task:offered', msg.data);
    }
  });
  ws.on('error', (err) => session.emitter.emit('notification-error', err.message));
  session.liveSocket = ws;
}
