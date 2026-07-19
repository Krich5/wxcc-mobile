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
  session.webexProfile = me;
  session.wxccOrgId = decodeSparkId(me.orgId);
  session.wxccCiUserId = decodeSparkId(me.id);
  return session.wxccOrgId;
}

export async function getWebexIdentity(session) {
  // displayName/avatar straight from Webex's own /v1/people/me (session.webexProfile,
  // cached by resolveOrgId() above the first time it runs) -- not the WxCC agent record,
  // which has no avatar field at all.
  await resolveOrgId(session);
  return {
    displayName: session.webexProfile?.displayName || null,
    avatar: session.webexProfile?.avatar || null,
  };
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

export async function getDesktopBranding(session) {
  // Confirmed via curl against this org: GET /v2/team?filter=id=="{teamId}" ->
  // team.desktopLayoutId -> GET /desktop-layout/{desktopLayoutId} ->
  // .jsonFileContent (a JSON-encoded STRING, not an object -- needs its own JSON.parse)
  // -> .agent.appTitle / .agent.logo. Purely cosmetic (header title + logo), so any
  // missing piece along this chain just falls back to null rather than throwing --
  // callers should fall back to the app's own defaults, never surface this as an error.
  if (session.desktopBranding !== undefined) return session.desktopBranding;
  const teamId = session.profile?.teamId;
  if (!teamId) return (session.desktopBranding = null);
  const ctx = await resolveAgentContext(session);
  const teamData = await authedFetch(
    session,
    `/organization/${ctx.orgId}/v2/team?filter=${encodeURIComponent(`id=="${teamId}"`)}`
  );
  const desktopLayoutId = teamData?.data?.[0]?.desktopLayoutId;
  if (!desktopLayoutId) return (session.desktopBranding = null);
  const layout = await authedFetch(session, `/organization/${ctx.orgId}/desktop-layout/${desktopLayoutId}`);
  let parsed;
  try {
    parsed = JSON.parse(layout?.jsonFileContent || '{}');
  } catch {
    return (session.desktopBranding = null);
  }
  const agentCfg = parsed?.agent || {};
  session.desktopBranding = {
    appTitle: agentCfg.appTitle || null,
    logo: agentCfg.logo || null,
  };
  return session.desktopBranding;
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
  // System codes (isSystemCode: true) are WxCC-reserved states, not ones an agent should
  // be able to manually pick -- excluded here too, not just in the accessIdleCode "ALL"
  // path below, since the same principle applies regardless of how the code got listed.
  return (data?.data || [])
    .filter((c) => !c.isSystemCode)
    .map((c) => ({ id: c.id, name: c.name || c.id, defaultCode: c.defaultCode }));
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

async function listAllAuxiliaryCodes(session) {
  // Unfiltered on purpose: the filter syntax this endpoint accepts for workTypeCode
  // isn't confirmed, whereas the plain id=in=(...) filter used elsewhere IS -- fetching
  // everything and filtering by workTypeCode in JS below avoids relying on a guess.
  // Paginated defensively (page/pageSize per this org's own meta.links.self shape,
  // confirmed via the /v2/team response) since an org-wide code list isn't bounded the
  // way a single agent-profile's handful of IDs is.
  const ctx = await resolveAgentContext(session);
  const all = [];
  let page = 0;
  for (let i = 0; i < 20; i += 1) {
    const data = await authedFetch(session, `/organization/${ctx.orgId}/v2/auxiliary-code?page=${page}&pageSize=100`);
    all.push(...(data?.data || []));
    const totalPages = data?.meta?.totalPages || 1;
    page += 1;
    if (page >= totalPages) break;
  }
  return all;
}

export async function getIdleCodes(session) {
  const profile = await loadAgentProfile(session);
  // Confirmed: when a desktop profile's accessIdleCode is "ALL" rather than a specific
  // list, profile.idleCodes doesn't carry the actual set of codes the agent should see --
  // the real list has to come from every org-wide auxiliary code whose workTypeCode is
  // IDLE_CODE, not just the ones named on this one profile.
  if (profile?.accessIdleCode === 'ALL') {
    const all = await listAllAuxiliaryCodes(session);
    return all
      .filter((c) => c.workTypeCode === 'IDLE_CODE' && !c.isSystemCode)
      .map((c) => ({ id: c.id, name: c.name || c.id, defaultCode: c.defaultCode }));
  }
  return resolveCodeNames(session, profile?.idleCodes);
}

export async function getWrapUpCodes(session) {
  const profile = await loadAgentProfile(session);
  // Confirmed (same principle as accessIdleCode above): when a desktop profile's
  // accessWrapUpCode is "ALL" rather than a specific list, profile.wrapUpCodes doesn't
  // carry the actual set -- falling back to resolveCodeNames() with an empty/wrong list
  // in that case meant wrap-up submitted a bogus auxCodeId and WxCC rejected it with
  // "Invalid wrap-up details". The real list has to come from every org-wide auxiliary
  // code whose workTypeCode is WRAP_UP_CODE instead.
  if (profile?.accessWrapUpCode === 'ALL') {
    const all = await listAllAuxiliaryCodes(session);
    return all
      .filter((c) => c.workTypeCode === 'WRAP_UP_CODE' && !c.isSystemCode)
      .map((c) => ({ id: c.id, name: c.name || c.id, defaultCode: c.defaultCode }));
  }
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

export async function getEntryPoints(session) {
  // Confirmed: GET /organization/{orgId}/v2/entry-point, paginated the same way as the
  // address book. Only telephony entry points make sense as a consult/transfer
  // destination for a voice call -- chat/email entry points are filtered out here rather
  // than left for the client to sort through.
  if (session.entryPoints) return session.entryPoints;
  const ctx = await resolveAgentContext(session);
  const entryPoints = [];
  let page = 0;
  let totalPages = 1;
  do {
    const data = await authedFetch(
      session,
      `/organization/${ctx.orgId}/v2/entry-point?page=${page}&pageSize=100&sortOrder=asc`
    );
    (data?.data || [])
      .filter((e) => e.channelType === 'TELEPHONY' && e.active)
      .forEach((e) => entryPoints.push({ id: e.id, name: e.name }));
    totalPages = data?.meta?.totalPages || 1;
    page += 1;
  } while (page < totalPages && page < 50);
  session.entryPoints = entryPoints;
  return entryPoints;
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

export async function getOutdialAnis(session) {
  // Confirmed via a live HAR capture of Cisco's own "EPIC" outdial widget: when a profile
  // has more than one caller-ID option, agent-profile.outdialANIId (note the ANI casing --
  // a different field than outdialEntryPointId below) points at GET /organization/{orgId}/
  // v2/outdial-ani/{outdialANIId}/entry, which returns the {id, name, number} list the
  // widget's "Outdial ANI" dropdown is built from. Plenty of profiles don't have this
  // configured at all -- an empty list here just means there's nothing to choose from,
  // not an error.
  const profile = await loadAgentProfile(session);
  const outdialAniId = profile?.outdialANIId;
  if (!outdialAniId) return [];
  const ctx = await resolveAgentContext(session);
  const data = await authedFetch(
    session,
    `/organization/${ctx.orgId}/v2/outdial-ani/${outdialAniId}/entry?page=0&pageSize=100`
  );
  return (data?.data || []).map((e) => ({
    id: e.id,
    name: e.name,
    number: e.number,
    isDefault: !!e.defaultANIEntry,
  }));
}

export async function startOutdial(session, { destination, ani }) {
  // Confirmed via a live HAR capture of Cisco's own "EPIC" outdial widget: POST
  // /v1/tasks/ (note the trailing slash) is the only place in this whole file that
  // CREATES a task rather than acting on an existing one -- every other tasks/{id}/...
  // endpoint here assumes the task already exists (via the inbound ContactOffered
  // notification). entryPointId always comes from this agent's OWN profile
  // (outdialEntryPointId). Caller-ID is a separate, optional concern: when the profile has
  // multiple ANIs configured (getOutdialAnis() above), the widget sends the agent's chosen
  // number as `origin` -- with zero/one option configured, no `origin` field is sent at
  // all and WxCC resolves it server-side instead.
  const profile = await loadAgentProfile(session);
  const entryPointId = profile?.outdialEntryPointId;
  if (!entryPointId) {
    throw new Error('Outbound calling is not enabled on your agent profile (no outdial entry point configured)');
  }
  const body = {
    destination,
    entryPointId,
    direction: 'OUTBOUND',
    attributes: {},
    mediaType: 'telephony',
    outboundType: 'OUTDIAL',
  };
  if (ani) body.origin = ani;
  const data = await authedFetch(session, '/v1/tasks/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data?.data || data;
}

export async function answerTask(session, taskId) {
  // TODO verify against the Call Control REST APIs (accept/answer contact).
  const data = await authedFetch(session, `/v2/agents/contact/${taskId}/accept`, { method: 'POST' });
  if (session.currentTask?.id === taskId) {
    session.currentTask.status = 'connected';
    // Return the ORIGINAL offered task (ani/queue/call variables, all sourced from the
    // real-time offer notification) with status flipped, not the bare accept response --
    // the client replaces its local task with whatever this returns, so returning `data`
    // here was silently wiping out everything the offer notification carried the moment
    // the agent answered.
    return session.currentTask;
  }
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

export async function pauseRecording(session, taskId) {
  // Confirmed via a live HAR capture of Cisco's own "EPIC" widget: POST
  // /v1/tasks/{taskId}/record/pause with an empty body.
  return authedFetch(session, `/v1/tasks/${taskId}/record/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function resumeRecording(session, taskId) {
  // Confirmed via the same capture: POST /v1/tasks/{taskId}/record/resume with
  // {autoResumed: false} -- the flag distinguishes a manual agent resume from WxCC's own
  // auto-resume (e.g. after a compliance pause window expires).
  return authedFetch(session, `/v1/tasks/${taskId}/record/resume`, {
    method: 'POST',
    body: JSON.stringify({ autoResumed: false }),
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
    // Confirmed via a live capture's own telemetry beacons (WXCC_SDK_WEBSOCKET_EVENT_RECEIVED,
    // tags.top_level_type/ws_event_type): a real incoming-call notification is envelope
    // type "RoutingMessage" with the specific event name in data.type -- "AgentContactReserved"
    // fires first (the reservation), "AgentOfferContact" right after (the actual offer this
    // agent sees) -- not the guessed "AgentContactEvent"/"ContactOffered" this originally
    // checked for, which is why the offer flow never fired in live mode before this. Matches
    // the same envelope shape already confirmed for AGENT_MULTI_LOGIN (outer type = broad
    // category, data.type = the specific event), rather than a directly-observed offer frame,
    // so treat this as informed-but-not-fully-confirmed until the next live call's raw
    // [wxcc notification] log lines are checked against it.
    if (msg?.type === 'RoutingMessage' && (msg?.data?.type === 'AgentOfferContact' || msg?.data?.type === 'AgentContactReserved')) {
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

  // Wait for WxCC's own "Welcome" handshake message before returning -- readyState
  // reaching OPEN only confirms the transport-level WS handshake, not that WxCC's
  // backend has actually finished registering this subscription. A caller that fires a
  // request depending on an async reply over this socket (e.g. buddyList) before Welcome
  // arrives races that registration, and the reply never comes. Falls back to a short
  // timeout instead of hanging forever, in case the Welcome shape/timing ever differs.
  await new Promise((resolve) => {
    const onNotification = (msg) => {
      if (msg?.type === 'Welcome') {
        session.emitter.off('raw-notification', onNotification);
        clearTimeout(fallback);
        resolve();
      }
    };
    session.emitter.on('raw-notification', onNotification);
    const fallback = setTimeout(() => {
      session.emitter.off('raw-notification', onNotification);
      resolve();
    }, 4000);
  });
}
