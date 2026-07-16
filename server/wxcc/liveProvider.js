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
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WxCC API ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function orgId() {
  const id = process.env.WXCC_ORG_ID;
  if (!id) throw new Error('WXCC_ORG_ID is not configured');
  return id;
}

function decodeSparkId(encoded) {
  // Webex "Cisco Spark" IDs are base64 of a URN like "ciscospark://us/PEOPLE/<uuid>" --
  // the UUID is the last path segment.
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  return decoded.split('/').pop();
}

async function webexPeopleMe(session) {
  if (!session.tokens?.access_token) {
    throw new Error('Not connected to Webex Contact Center (no access token) - use /api/auth/login first');
  }
  const res = await fetch('https://webexapis.com/v1/people/me', {
    headers: { Authorization: `Bearer ${session.tokens.access_token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Webex people/me failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function resolveAgentContext(session) {
  // Confirmed pipeline: GET https://webexapis.com/v1/people/me -> decode its base64 id
  // to get the CI user ID -> GET /organization/{orgid}/v2/user/by-ci-user-id/{ciUserId}
  // for the WxCC user record (id = agentId used by the state-change PUT, agentProfileId
  // for idle/wrap-up codes, teamIds for the team picker).
  if (session.agentContext) return session.agentContext;
  const me = await webexPeopleMe(session);
  const ciUserId = decodeSparkId(me.id);
  const user = await authedFetch(session, `/organization/${orgId()}/v2/user/by-ci-user-id/${ciUserId}`);
  if (!user?.id) throw new Error('No WxCC user found for your Webex account');
  session.agentContext = {
    agentId: user.id,
    agentProfileId: user.agentProfileId,
    teamIds: user.teamIds || [],
  };
  return session.agentContext;
}

export async function listTeams(session) {
  // Lists only the teams the signed-in agent can log into, via resolveAgentContext()'s
  // teamIds. Falls back to every team in the org if identity resolution fails.
  try {
    const ctx = await resolveAgentContext(session);
    if (ctx.teamIds?.length) {
      const data = await authedFetch(
        session,
        `/organization/${orgId()}/v2/team?filter=${encodeURIComponent(
          `id=in=(${ctx.teamIds.map((id) => `"${id}"`).join(',')})`
        )}`
      );
      return (data?.data || []).map((team) => ({ id: team.id, name: team.name || team.id }));
    }
  } catch {
    // fall through to the org-wide list below
  }
  const data = await authedFetch(session, `/organization/${orgId()}/v2/team`);
  return (data?.data || []).map((team) => ({ id: team.id, name: team.name || team.id }));
}

async function loadAgentProfile(session) {
  if (session.agentProfileData) return session.agentProfileData;
  const ctx = await resolveAgentContext(session);
  if (!ctx?.agentProfileId) {
    throw new Error('No agent profile found for your account');
  }
  // Confirmed against this org's own curl example: GET
  // /organization/{orgid}/agent-profile/{agentProfileId} -> { idleCodes: [ids],
  // wrapUpCodes: [ids], ... }.
  session.agentProfileData = await authedFetch(
    session,
    `/organization/${orgId()}/agent-profile/${ctx.agentProfileId}`
  );
  return session.agentProfileData;
}

async function resolveCodeNames(session, ids) {
  if (!ids?.length) return [];
  // Confirmed: idle codes and wrap-up codes are both drawn from the same Auxiliary
  // Code resource (GET /organization/{orgid}/v2/auxiliary-code) -- the agent-profile
  // only gives us bare IDs, this resolves them to display names.
  const data = await authedFetch(
    session,
    `/organization/${orgId()}/v2/auxiliary-code?filter=${encodeURIComponent(
      `id=in=(${ids.map((id) => `"${id}"`).join(',')})`
    )}`
  );
  return (data?.data || []).map((c) => ({ id: c.id, name: c.name || c.id }));
}

export async function getIdleCodes(session) {
  const profile = await loadAgentProfile(session);
  return resolveCodeNames(session, profile?.idleCodes);
}

export async function getWrapUpCodes(session) {
  const profile = await loadAgentProfile(session);
  return resolveCodeNames(session, profile?.wrapUpCodes);
}

export async function login(session, { dialNumber, teamId, deviceType = 'EXTENSION' }) {
  // Confirmed against this org's own Postman/curl example: POST /v2/agents/login
  // (not /v1), body is exactly {dialNumber, teamId, roles, deviceType} -- no
  // isExtension field, and deviceType is "EXTENSION" rather than "BROWSER".
  const data = await authedFetch(session, '/v2/agents/login', {
    method: 'POST',
    body: JSON.stringify({ dialNumber, teamId, roles: ['agent'], deviceType }),
  });
  session.agentState = 'Available';
  session.profile = { ...(data?.agent || {}), teamId, dialNumber };
  // Non-fatal: the agent is already logged in on WxCC's side even if this fails --
  // it just means status/wrap-up codes won't be available until it's resolved.
  await resolveAgentContext(session).catch(() => {});
  return data;
}

export async function logout(session, { reasonCode = 'AgentLogout' } = {}) {
  // TODO verify path/body -- bumped to /v2 to match the confirmed login endpoint, but
  // this specific path/body shape is still unverified.
  const data = await authedFetch(session, '/v2/agents/logout', {
    method: 'POST',
    body: JSON.stringify({ logoutReason: reasonCode }),
  });
  session.agentState = 'Offline';
  session.profile = null;
  session.currentTask = null;
  if (session.liveSocket) {
    session.liveSocket.close();
    session.liveSocket = null;
  }
  return data;
}

export async function setState(session, state, { auxCodeId, reason } = {}) {
  // Confirmed against this org's own curl example: PUT /v2/agents/session/state with
  // {channelType, state, agentId, auxCodeId, reason} -- auxCodeId/reason are only sent
  // for non-Available states.
  const ctx = await resolveAgentContext(session);
  const body = { channelType: ['telephony'], state, agentId: ctx.agentId };
  if (state !== 'Available') {
    body.auxCodeId = auxCodeId;
    body.reason = reason;
  }
  const data = await authedFetch(session, '/v2/agents/session/state', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  session.agentState = state;
  return data;
}

export async function answerTask(session, taskId) {
  // TODO verify against the Call Control REST APIs (accept/answer contact).
  const data = await authedFetch(session, `/v2/agents/contact/${taskId}/accept`, { method: 'POST' });
  if (session.currentTask?.id === taskId) session.currentTask.status = 'connected';
  return data;
}

export async function endTask(session, taskId) {
  // TODO verify against the Call Control REST APIs (end contact).
  const data = await authedFetch(session, `/v2/agents/contact/${taskId}/end`, { method: 'POST' });
  if (session.currentTask?.id === taskId) session.currentTask.status = 'wrapup';
  return data;
}

export async function wrapupTask(session, taskId, code) {
  // TODO verify wrap-up-code submission endpoint/field names.
  const data = await authedFetch(session, `/v2/agents/contact/${taskId}/wrapup`, {
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
    body: JSON.stringify({ isKeepAliveEnabled: true, keepAliveInterval: 30, force: true }),
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
