// Best-effort integration against the real Webex Contact Center Agent REST/WebSocket
// APIs (https://developer.webex-cx.com). Endpoint paths and payload shapes below are
// drawn from public Cisco blog posts and starter samples, NOT a verified Postman
// collection -- confirm every path/field against your own authenticated
// developer.webex-cx.com account (requires a WxCC-licensed org) before relying on this.
// Each TODO marks a spot to double check.
import WebSocket from 'ws';

export function baseUrl() {
  const url = process.env.WXCC_API_BASE_URL;
  if (!url) throw new Error('WXCC_API_BASE_URL is not configured');
  return url;
}

export async function authedFetch(session, path, opts = {}) {
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

export async function resolveAgentContext(session) {
  // Confirmed pipeline: GET https://webexapis.com/v1/people/me -> decode its base64 id
  // AND its base64 orgId (same response, no separate lookup needed) -> GET
  // /organization/{orgid}/v2/user/by-ci-user-id/{ciUserId} for the WxCC user record
  // (id = agentId used by the state-change PUT, agentProfileId for idle/wrap-up codes,
  // teamIds for the team picker, deafultDialledNumber -- yes, misspelled in the actual
  // API response -- for pre-filling the dial number field).
  if (session.agentContext) return session.agentContext;
  const orgId = await resolveOrgId(session);
  const user = await authedFetch(session, `/organization/${orgId}/v2/user/by-ci-user-id/${session.wxccCiUserId}`);
  if (!user?.id) throw new Error('No WxCC user found for your Webex account');
  session.agentContext = {
    orgId,
    agentId: user.id,
    agentProfileId: user.agentProfileId,
    teamIds: user.teamIds || [],
    defaultDialNumber: user.deafultDialledNumber || '',
  };
  return session.agentContext;
}

export async function getDefaultDialNumber(session) {
  try {
    const ctx = await resolveAgentContext(session);
    return ctx.defaultDialNumber || '';
  } catch {
    return '';
  }
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
    throw new Error('Unauthorized — could not verify your Webex identity. Try signing out and back in.');
  }
  const data = await authedFetch(session, `/organization/${orgId}/v2/team`);
  return (data?.data || []).map((team) => ({ id: team.id, name: team.name || team.id }));
}

export async function loadAgentProfile(session) {
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

export async function getBuddyAgents(session, { state } = {}) {
  // Confirmed via curl: POST /v1/agents/buddyList with {agentProfileId, mediaType,
  // state?} -- state is "Available" or "Idle"; omitting it returns both (useful for
  // consult, which can target an idle agent; transfer should be restricted to Available
  // only on the client). This is the correct, purpose-built replacement for the earlier
  // agentSession-based approach, which returned WxCC's "Contact Center User Id" --
  // rejected by /consult and /transfer with "the destination agent ID is invalid" -- and
  // for the /v2/user reverse-lookup attempt, which 403'd (this agent has no admin-level
  // {user} permission).
  //
  // The HTTP response is just a 202 acknowledgment ("request accepted for processing"),
  // NOT the agent list -- confirmed the real data arrives asynchronously over the
  // notification WebSocket subscribeNotifications() already opens. Neither that
  // message's event-type field nor its agent-list shape is confirmed yet, so this waits
  // for the next non-keepalive/non-Welcome message after the POST and best-effort-parses
  // it, logging the raw payload unconditionally so the real shape can be nailed down
  // from Railway logs on first use. Note: if some OTHER notification (e.g. a live call's
  // own state change) happens to land in that same window, this could misattribute it --
  // acceptable for now since the raw log makes that obvious to spot and fix.
  const ctx = await resolveAgentContext(session);
  if (!ctx?.agentProfileId) throw new Error('No agent profile found for your account');
  if (!session.tokens?.access_token) {
    throw new Error('Not connected to Webex Contact Center (no access token) - use /api/auth/login first');
  }
  await ensureNotificationSocket(session);

  const waitForResponse = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.emitter.off('raw-notification', onMessage);
      reject(new Error('Timed out waiting for the buddy agents response'));
    }, 8000);
    const onMessage = (msg) => {
      if (!msg || msg.keepalive || msg.type === 'Welcome') return;
      clearTimeout(timeout);
      session.emitter.off('raw-notification', onMessage);
      resolve(msg);
    };
    session.emitter.on('raw-notification', onMessage);
  });

  const res = await fetch(`${baseUrl()}/v1/agents/buddyList`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.tokens.access_token}`,
    },
    body: JSON.stringify({
      agentProfileId: ctx.agentProfileId,
      mediaType: 'telephony',
      ...(state ? { state } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WxCC API /v1/agents/buddyList failed: ${res.status} ${text}`);
  }
  console.log('[buddyList] POST accepted:', text);

  const raw = await waitForResponse;
  console.log('[buddyList] async response received:', JSON.stringify(raw));

  const list = raw?.data?.agents || raw?.data?.buddyAgents || raw?.agents || raw?.buddyAgents || raw?.data || [];
  const agents = (Array.isArray(list) ? list : [])
    .map((a) => ({
      id: a.agentId || a.id || a.userId || null,
      name: a.agentName || a.name || a.displayName || a.id || 'Unknown',
      state: (a.state || a.agentState || '').toString(),
    }))
    .filter((a) => a.id);

  return { agents, raw };
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

export async function getDefaultWrapUpCode(session) {
  // Same defaultCode flag as idle codes, just scoped to the wrap-up-code list -- used to
  // auto-submit a wrap-up when the agent doesn't pick one within autoWrapAfterSeconds.
  const codes = await getWrapUpCodes(session);
  return codes.find((c) => c.defaultCode) || null;
}

export async function getAddressBookEntries(session) {
  // Confirmed: agent-profile.addressBookId points at GET /organization/{orgId}/v2/
  // address-book/{addressBookId}/entry, paginated via meta.page/meta.totalPages -- fetch
  // every page (cached on the session) so search covers the whole book, not just
  // whatever fits on page 0.
  if (session.addressBookEntries) return session.addressBookEntries;
  const ctx = await resolveAgentContext(session);
  const profile = await loadAgentProfile(session);
  const addressBookId = profile?.addressBookId;
  if (!addressBookId) return [];
  const entries = [];
  let page = 0;
  let totalPages = 1;
  do {
    const data = await authedFetch(
      session,
      `/organization/${ctx.orgId}/v2/address-book/${addressBookId}/entry?page=${page}&pageSize=100`
    );
    (data?.data || []).forEach((e) => entries.push({ id: e.id, name: e.name || e.number, number: e.number }));
    totalPages = data?.meta?.totalPages || 1;
    page += 1;
  } while (page < totalPages && page < 50);
  session.addressBookEntries = entries;
  return entries;
}

export async function getWrapUpSettings(session) {
  const profile = await loadAgentProfile(session);
  // Confirmed: agent-profile.autoWrapAfterSeconds is actually in MILLISECONDS despite
  // its name -- use it directly as a setTimeout duration. 0/missing means auto-wrap-up
  // isn't configured for this profile. Logged raw so a reported mismatch (e.g. firing
  // faster than this value implies) can be cross-checked against what the client logs.
  const raw = profile?.autoWrapAfterSeconds;
  const autoWrapAfterMs = Number(raw) || 0;
  console.log(`[wrapup] agent-profile.autoWrapAfterSeconds raw=${JSON.stringify(raw)} -> autoWrapAfterMs=${autoWrapAfterMs}`);
  return { autoWrapAfterMs };
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
  // Confirmed: POST /v1/tasks/{taskId}/end -- not the /v2/agents/contact/... path this
  // was originally guessed as.
  return authedFetch(session, `/v1/tasks/${taskId}/end`, { method: 'POST' });
}

export async function holdTask(session, taskId) {
  // Confirmed: POST /v1/tasks/{taskId}/hold requires {mediaResourceId: taskId} in the
  // body (Cisco returns 400 "Request body is missing" otherwise) -- not bodyless as
  // originally assumed. mediaResourceId is the same value as the taskId itself in the
  // confirmed example.
  return authedFetch(session, `/v1/tasks/${taskId}/hold`, {
    method: 'POST',
    body: JSON.stringify({ mediaResourceId: taskId }),
  });
}

export async function unholdTask(session, taskId) {
  // Confirmed: POST /v1/tasks/{taskId}/unhold also requires {mediaResourceId: taskId}
  // in the body, same as /hold.
  return authedFetch(session, `/v1/tasks/${taskId}/unhold`, {
    method: 'POST',
    body: JSON.stringify({ mediaResourceId: taskId }),
  });
}

export async function consultTask(session, taskId, to, destinationType = 'dialNumber') {
  // Confirmed: POST /v1/tasks/{taskId}/consult with {to, destinationType,
  // holdParticipants: true}. destinationType is "dialNumber", "agent", "queue", or
  // "entryPoint" -- "to" is the matching id (a raw number for dialNumber, an agent/
  // queue/entry-point id otherwise).
  return authedFetch(session, `/v1/tasks/${taskId}/consult`, {
    method: 'POST',
    body: JSON.stringify({ to, destinationType, holdParticipants: true }),
  });
}

export async function transferTask(session, taskId, to, destinationType = 'dialNumber') {
  // Confirmed: POST /v1/tasks/{taskId}/transfer with {to, destinationType}.
  return authedFetch(session, `/v1/tasks/${taskId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ to, destinationType }),
  });
}

export async function consultTransfer(session, taskId, to, destinationType = 'dialNumber') {
  // Confirmed: POST /v1/tasks/{taskId}/consult/transfer with {to, destinationType} --
  // completes an in-progress consult by transferring the original call to the
  // consulted party.
  return authedFetch(session, `/v1/tasks/${taskId}/consult/transfer`, {
    method: 'POST',
    body: JSON.stringify({ to, destinationType }),
  });
}

export async function consultEnd(session, taskId) {
  // Confirmed: POST /v1/tasks/{taskId}/consult/end with {} -- ends the consult leg,
  // returning to just the original call.
  return authedFetch(session, `/v1/tasks/${taskId}/consult/end`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function consultConference(session, taskId, to, destinationType = 'dialNumber') {
  // Confirmed: POST /v1/tasks/{taskId}/consult/conference with {to, destinationType} --
  // merges the consult into a 3-way conference.
  return authedFetch(session, `/v1/tasks/${taskId}/consult/conference`, {
    method: 'POST',
    body: JSON.stringify({ to, destinationType }),
  });
}

export async function wrapupTask(session, taskId, { auxCodeId, wrapUpReason } = {}) {
  // Confirmed against this org's own curl example: POST /v1/tasks/{taskId}/wrapup with
  // {auxCodeId, wrapUpReason} -- not the /v2/agents/contact/... path or wrapUpCode field
  // this was originally guessed as.
  const data = await authedFetch(session, `/v1/tasks/${taskId}/wrapup`, {
    method: 'POST',
    body: JSON.stringify({ auxCodeId, wrapUpReason }),
  });
  session.currentTask = null;
  return data;
}

export async function ensureNotificationSocket(session) {
  // Self-healing: the socket can be missing either because it was never (re)established
  // after a server restart (the "already logged in" fast path doesn't call
  // subscribeNotifications the way a full /login does) or because it simply dropped
  // mid-shift (Cisco's gateway closing an idle connection, a network blip, etc.) --
  // either way, try to open a fresh one on demand rather than permanently failing
  // whatever needs it (e.g. getBuddyAgents) until the next full login.
  if (session.liveSocket && session.liveSocket.readyState === WebSocket.OPEN) return;
  await subscribeNotifications(session);
}

export async function subscribeNotifications(session) {
  // TODO verify against "Register WebSocket Subscription" in the Agent Postman
  // collection -- response field name for the socket URL and the event/type names
  // used for a newly-offered contact are best-effort placeholders here.
  const sub = await authedFetch(session, '/v1/notification/subscribe', {
    method: 'POST',
    body: JSON.stringify({ isKeepAliveEnabled: true, keepAliveInterval: 30, force: true }),
  });
  // Logged unconditionally (not just on failure) so the very first real login after
  // this deploy tells us the actual response shape -- websocketUrl was always a guess,
  // never confirmed against a real response, which is exactly why this doesn't work.
  console.log('[notifications] subscribe response:', JSON.stringify(sub));
  const websocketUrl =
    sub?.websocketUrl || sub?.webSocketUrl || sub?.url || sub?.uri || sub?.data?.websocketUrl || sub?.data?.webSocketUrl;
  if (!websocketUrl) {
    throw new Error('Notification subscribe response did not include a websocketUrl');
  }
  const ws = new WebSocket(websocketUrl);
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
