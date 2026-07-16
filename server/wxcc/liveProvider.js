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

async function resolveOrgId(session) {
  // Split out from resolveAgentContext() so a failed by-ci-user-id lookup (e.g. this
  // agent isn't a WxCC user, or some other per-agent issue) never falls back to a
  // different, hardcoded org via WXCC_ORG_ID -- that env var is this deployment's
  // owner's org, which is simply wrong for any other agent/org.
  if (session.wxccOrgId) return session.wxccOrgId;
  const me = await webexPeopleMe(session);
  session.wxccOrgId = decodeSparkId(me.orgId);
  session.wxccCiUserId = decodeSparkId(me.id);
  return session.wxccOrgId;
}

async function resolveAgentContext(session) {
  // Confirmed pipeline: GET https://webexapis.com/v1/people/me -> decode its base64 id
  // AND its base64 orgId (same response, no separate lookup needed) -> GET
  // /organization/{orgid}/v2/user/by-ci-user-id/{ciUserId} for the WxCC user record
  // (id = agentId used by the state-change PUT, agentProfileId for idle/wrap-up codes,
  // teamIds for the team picker).
  if (session.agentContext) return session.agentContext;
  const orgId = await resolveOrgId(session);
  const user = await authedFetch(session, `/organization/${orgId}/v2/user/by-ci-user-id/${session.wxccCiUserId}`);
  if (!user?.id) throw new Error('No WxCC user found for your Webex account');
  session.agentContext = {
    orgId,
    agentId: user.id,
    agentProfileId: user.agentProfileId,
    teamIds: user.teamIds || [],
  };
  return session.agentContext;
}

export async function listTeams(session) {
  // Lists only the teams the signed-in agent can log into, via resolveAgentContext()'s
  // teamIds. Falls back to every team in the agent's OWN org (resolveOrgId(), which
  // only needs people/me to succeed, not the per-agent by-ci-user-id lookup) if the
  // rest of identity resolution fails. WXCC_ORG_ID is a last resort only if people/me
  // itself fails -- it's this deployment's owner's org, not necessarily the signed-in
  // agent's.
  let ctx = null;
  try {
    ctx = await resolveAgentContext(session);
  } catch {
    // fall through -- resolveOrgId() may still have succeeded even though the
    // per-agent lookup failed
  }
  if (ctx?.teamIds?.length) {
    const data = await authedFetch(
      session,
      `/organization/${ctx.orgId}/v2/team?filter=${encodeURIComponent(
        `id=in=(${ctx.teamIds.map((id) => `"${id}"`).join(',')})`
      )}`
    );
    return (data?.data || []).map((team) => ({ id: team.id, name: team.name || team.id }));
  }
  let orgId = ctx?.orgId || session.wxccOrgId;
  if (!orgId) {
    orgId = await resolveOrgId(session).catch(() => process.env.WXCC_ORG_ID);
  }
  if (!orgId) {
    throw new Error('Could not resolve your org (people/me failed and WXCC_ORG_ID is not set as a fallback)');
  }
  const data = await authedFetch(session, `/organization/${orgId}/v2/team`);
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
    `/organization/${ctx.orgId}/agent-profile/${ctx.agentProfileId}`
  );
  return session.agentProfileData;
}

async function resolveCodeNames(session, ids) {
  if (!ids?.length) return [];
  // Confirmed: idle codes and wrap-up codes are both drawn from the same Auxiliary
  // Code resource (GET /organization/{orgid}/v2/auxiliary-code) -- the agent-profile
  // only gives us bare IDs, this resolves them to display names.
  const ctx = await resolveAgentContext(session);
  const data = await authedFetch(
    session,
    `/organization/${ctx.orgId}/v2/auxiliary-code?filter=${encodeURIComponent(
      `id=in=(${ids.map((id) => `"${id}"`).join(',')})`
    )}`
  );
  return (data?.data || []).map((c) => ({ id: c.id, name: c.name || c.id, defaultCode: c.defaultCode }));
}

export async function getIdleCodes(session) {
  const profile = await loadAgentProfile(session);
  return resolveCodeNames(session, profile?.idleCodes);
}

export async function getWrapUpCodes(session) {
  const profile = await loadAgentProfile(session);
  return resolveCodeNames(session, profile?.wrapUpCodes);
}

export async function getDefaultIdleCode(session) {
  // Confirmed: /v2/auxiliary-code entries have a defaultCode flag (only one true per
  // workTypeCode) -- the agent should land in this idle reason immediately after login.
  const codes = await getIdleCodes(session);
  return codes.find((c) => c.defaultCode) || null;
}

export async function login(session, { dialNumber, teamId, teamName, deviceType = 'EXTENSION' }) {
  // Confirmed against this org's own Postman/curl example: POST /v2/agents/login
  // (not /v1), body is exactly {dialNumber, teamId, roles, deviceType} -- no
  // isExtension field, and deviceType is "EXTENSION" rather than "BROWSER".
  const data = await authedFetch(session, '/v2/agents/login', {
    method: 'POST',
    body: JSON.stringify({ dialNumber, teamId, roles: ['agent'], deviceType }),
  });
  session.agentState = 'Available';
  session.profile = { ...(data?.agent || {}), teamId, teamName, dialNumber };
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
  // Match the "Idle: <reason>" format the client uses for its own optimistic update --
  // this call also runs automatically right after login (default idle reason), so the
  // server's own agentState needs the reason suffix too, not just the bare word "Idle".
  session.agentState = state === 'Available' ? 'Available' : `Idle: ${reason}`;
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
  // We told the subscribe call keepAliveInterval: 30, which means WE'RE responsible for
  // keeping the socket alive, not just the server. Sending a raw WS ping frame every
  // 15s (well under 30s) is the protocol-correct default; if Cisco's gateway expects an
  // application-level heartbeat message instead of a transport ping, this will need
  // adjusting once we can see the socket actually drop.
  const keepAlive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 15000);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      // Temporary: log every raw frame (even non-JSON) so we can see the real message
      // shape from a live call and fix the guessed AgentContactEvent/ContactOffered
      // matching below -- remove once that's confirmed.
      console.log('[wxcc notification] non-JSON frame:', raw.toString());
      return;
    }
    console.log('[wxcc notification]', JSON.stringify(msg));
    session.emitter.emit('raw-notification', msg);
    if (msg?.type === 'AgentContactEvent' && msg?.eventType === 'ContactOffered') {
      session.currentTask = msg.data;
      session.emitter.emit('task:offered', msg.data);
    }
  });
  ws.on('error', (err) => session.emitter.emit('notification-error', err.message));
  ws.on('close', () => {
    clearInterval(keepAlive);
    if (session.liveSocket === ws) session.liveSocket = null;
    session.emitter.emit('notification-closed');
  });
  session.liveSocket = ws;
}
