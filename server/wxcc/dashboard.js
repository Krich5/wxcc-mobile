// Realtime queue + agent-state dashboard, scoped to whatever this agent's desktop
// profile is actually permitted to see (agent-profile.viewableStatistics.contactServiceQueues
// / .teams) rather than the whole org. GraphQL queries (task search + agentSession) are
// ported from an existing in-house WxCC supervisor dashboard that already confirmed them
// working against this same /search endpoint.
import { authedFetch, baseUrl, resolveAgentContext, loadAgentProfile } from './liveProvider.js';

const SERVICE_LEVEL_THRESHOLD_SEC = 30;
const MAX_TASK_PAGES = 50;

async function runGraphQL(session, query) {
  const ctx = await resolveAgentContext(session);
  const res = await fetch(`${baseUrl()}/search?orgId=${encodeURIComponent(ctx.orgId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.tokens.access_token}`,
      OrgId: ctx.orgId,
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WxCC search failed: ${res.status} ${text}`);
  const payload = text ? JSON.parse(text) : null;
  if (payload?.error) throw new Error(`WxCC search error: ${JSON.stringify(payload.error)}`);
  return payload?.data || null;
}

function buildParkedTaskQuery(fromMs, toMs, cursor = '0') {
  return `{
  task(
    from: ${Math.floor(fromMs)}
    to: ${Math.floor(toMs)}
    timeComparator: createdTime
    filter: { and: [
      { isActive: { equals: true } }
      { status: { equals: "parked" } }
      { channelType: { equals: telephony } }
      { direction: { equals: "inbound" } }
    ] }
    pagination: { cursor: "${cursor}" }
  ) {
    tasks {
      id status createdTime queueDuration connectedDuration terminationType
      lastQueue { id name } lastTeam { id name } owner { id name }
    }
    pageInfo { endCursor hasNextPage }
  }
}`;
}

function buildConnectedTaskQuery(fromMs, toMs, cursor = '0') {
  return `{
  task(
    from: ${Math.floor(fromMs)}
    to: ${Math.floor(toMs)}
    timeComparator: createdTime
    filter: { and: [
      { status: { equals: "connected" } }
      { channelType: { equals: telephony } }
      { direction: { equals: "inbound" } }
    ] }
    pagination: { cursor: "${cursor}" }
  ) {
    tasks { id status lastQueue { id name } lastTeam { id name } }
    pageInfo { endCursor hasNextPage }
  }
}`;
}

function buildDailyTaskQuery(fromMs, toMs, cursor = '0') {
  return `{
  task(
    from: ${Math.floor(fromMs)}
    to: ${Math.floor(toMs)}
    timeComparator: createdTime
    filter: { and: [
      { channelType: { equals: telephony } }
      { direction: { equals: "inbound" } }
    ] }
    pagination: { cursor: "${cursor}" }
  ) {
    tasks {
      id isActive status createdTime connectedDuration terminationType
      lastQueue { id name } lastTeam { id name } owner { id name }
    }
    pageInfo { endCursor hasNextPage }
  }
}`;
}

function buildSessionQuery(fromMs, toMs) {
  return `{
  agentSession(
    from: ${Math.floor(fromMs)}
    to: ${Math.floor(toMs)}
    filter: { and: [
      { isActive: { equals: true } }
      { channelInfo: { channelType: { equals: "telephony" } } }
    ] }
  ) {
    agentSessions {
      agentId agentName teamId teamName startTime
      channelInfo { channelType currentState lastActivityTime idleCodeName connectedCount ronaCount }
    }
  }
}`;
}

function buildActiveCallQuery(fromMs, toMs, ownerId, cursor = '0') {
  // Confirmed against this org's own curl example: taskDetails (a different top-level
  // GraphQL field than task/agentSession above) filtered by owner.id -- this is the
  // richest per-call record available (origin/destination, durations, customer info),
  // used here just to answer "is this agent on a call right now, and with whom."
  return `{
  taskDetails(
    from: ${Math.floor(fromMs)}
    to: ${Math.floor(toMs)}
    filter: { and: [
      { owner: { id: { equals: "${ownerId}" } } }
      { isActive: { equals: true } }
    ] }
    pagination: { cursor: "${cursor}" }
  ) {
    tasks {
      id status isActive origin destination createdTime channelType direction
      owner { id name }
      lastTeam { id name }
      lastEntryPoint { id name }
      customer { name phoneNumber email }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
}

function buildCallHistoryQuery(fromMs, toMs, ownerId, cursor = '0') {
  // Same taskDetails resource as the active-call query, just isActive:false (ended
  // calls) instead of true -- gives us the per-call duration breakdown (talk/hold/
  // consult/conference/wrap-up) for the Call Log.
  return `{
  taskDetails(
    from: ${Math.floor(fromMs)}
    to: ${Math.floor(toMs)}
    filter: { and: [
      { owner: { id: { equals: "${ownerId}" } } }
      { isActive: { equals: false } }
    ] }
    pagination: { cursor: "${cursor}" }
  ) {
    tasks {
      id status direction origin destination createdTime endedTime
      totalDuration connectedDuration holdDuration consultDuration conferenceDuration
      wrapupDuration lastWrapupCodeName terminationType
      lastTeam { id name }
      customer { name phoneNumber email }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
}

const CALL_HISTORY_MAX_PAGES = 10;
const CALL_HISTORY_LIMIT = 25;
const CALL_HISTORY_LOOKBACK_DAYS = 7;

export async function getCallHistory(session, { limit = CALL_HISTORY_LIMIT } = {}) {
  const ctx = await resolveAgentContext(session);
  const now = Date.now();
  const fromMs = now - CALL_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const allTasks = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let cursor = '0';
  for (let page = 0; page < CALL_HISTORY_MAX_PAGES; page += 1) {
    const data = await runGraphQL(session, buildCallHistoryQuery(fromMs, now, ctx.agentId, cursor));
    const node = data?.taskDetails;
    const tasks = Array.isArray(node?.tasks) ? node.tasks : [];
    tasks.forEach((t) => {
      const id = String(t?.id || '');
      if (id && seenIds.has(id)) return;
      if (id) seenIds.add(id);
      allTasks.push(t);
    });
    const nextCursor = node?.pageInfo?.endCursor;
    if (!node?.pageInfo?.hasNextPage || !nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  allTasks.sort((a, b) => (b?.createdTime || 0) - (a?.createdTime || 0));
  return allTasks.slice(0, limit).map((t) => ({
    id: t.id,
    direction: t.direction,
    caller: t.customer?.name || t.customer?.phoneNumber || t.origin || 'Unknown',
    phone: t.customer?.phoneNumber || t.origin || null,
    team: t.lastTeam?.name || null,
    createdTimeMs: t.createdTime,
    endedTimeMs: t.endedTime,
    // connectedDuration is the actual talk time -- total/hold/consult/conference/wrapup
    // are all in the same (millisecond) units, converted via the same toSeconds() the
    // rest of this file already uses for these GraphQL duration fields.
    talkSec: toSeconds(Number(t.connectedDuration)),
    holdSec: toSeconds(Number(t.holdDuration)),
    consultSec: toSeconds(Number(t.consultDuration)),
    conferenceSec: toSeconds(Number(t.conferenceDuration)),
    wrapupSec: toSeconds(Number(t.wrapupDuration)),
    totalSec: toSeconds(Number(t.totalDuration)),
    wrapUpCode: t.lastWrapupCodeName || null,
    terminationType: t.terminationType || null,
  }));
}

function buildSelfSessionQuery(fromMs, toMs, agentId) {
  // Same agentSession resource as buildSessionQuery/getDashboard, but filtered directly
  // to this agent -- cheap enough to run on every app load/reload to answer "is this
  // agent already logged into WxCC right now" without waiting for the full dashboard.
  return `{
  agentSession(
    from: ${Math.floor(fromMs)}
    to: ${Math.floor(toMs)}
    filter: { and: [
      { agentId: { equals: "${agentId}" } }
      { isActive: { equals: true } }
    ] }
  ) {
    agentSessions {
      agentId agentName teamId teamName startTime
      channelInfo { channelType currentState lastActivityTime idleCodeName connectedCount ronaCount }
    }
  }
}`;
}

export async function checkExistingSession(session) {
  // WxCC itself already knows whether this agent is logged in -- a server restart
  // (which wipes our own in-memory session.profile) shouldn't force them back through
  // the team/dial-number picker and re-run /v2/agents/login (which would reset whatever
  // real state -- Available, mid-call, a custom idle reason -- they were actually in).
  const ctx = await resolveAgentContext(session);
  const now = Date.now();
  const fromMs = now - 24 * 60 * 60 * 1000; // a still-open session could have started yesterday
  const data = await runGraphQL(session, buildSelfSessionQuery(fromMs, now, ctx.agentId));
  const row = (data?.agentSession?.agentSessions || [])[0];
  if (!row) return null;
  const stateValue = getSessionState(row);
  const bucket = categorizeAgentState(stateValue);
  const channels = Array.isArray(row?.channelInfo) ? row.channelInfo : [row?.channelInfo].filter(Boolean);
  const telCh = channels.find((c) => c?.channelType === 'telephony') || channels[0];
  return {
    teamId: row.teamId || null,
    teamName: row.teamName || null,
    state: bucket,
    stateLabel: getStateBadgeLabel(stateValue),
    idleCode: bucket === 'idle' ? telCh?.idleCodeName || null : null,
  };
}

function getCallStatusLabel(rawStatus) {
  // Confirmed: taskDetails.status is "connect" while the call is still ringing/alerting
  // (before the agent answers) and "connected" once actually talking -- neither is the
  // agent-facing word we want, so map both to what the agent should see.
  const s = (rawStatus || '').toLowerCase();
  if (s === 'connect') return 'Ringing';
  if (s === 'connected' || s === 'talking') return 'Engaged';
  return rawStatus || 'Active';
}

export async function getActiveCall(session) {
  const ctx = await resolveAgentContext(session);
  const now = Date.now();
  // Look back a few hours, not just "today" -- an active call could have started
  // just before midnight and still be running.
  const fromMs = now - 4 * 60 * 60 * 1000;
  const data = await runGraphQL(session, buildActiveCallQuery(fromMs, now, ctx.agentId));
  const tasks = data?.taskDetails?.tasks || [];
  const active = tasks.find((t) => t.isActive) || null;
  if (!active) return null;
  return {
    id: active.id,
    status: active.status,
    statusLabel: getCallStatusLabel(active.status),
    direction: active.direction,
    origin: active.origin,
    destination: active.destination,
    createdTimeMs: active.createdTime,
    team: active.lastTeam?.name || null,
    entryPoint: active.lastEntryPoint?.name || null,
    customerName: active.customer?.name || null,
    customerPhone: active.customer?.phoneNumber || active.origin || null,
  };
}

async function fetchAllTaskPages(session, buildQuery, fromMs, toMs) {
  const allTasks = [];
  const seenTaskIds = new Set();
  const seenCursors = new Set();
  let cursor = '0';
  for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
    const data = await runGraphQL(session, buildQuery(fromMs, toMs, cursor));
    if (!data?.task) break;
    const taskNode = data.task;
    const tasks = Array.isArray(taskNode?.tasks) ? taskNode.tasks : [];
    const pageInfo = taskNode?.pageInfo || {};
    tasks.forEach((task) => {
      const taskId = String(task?.id || '');
      if (taskId && seenTaskIds.has(taskId)) return;
      if (taskId) seenTaskIds.add(taskId);
      allTasks.push(task);
    });
    const nextCursor = pageInfo?.endCursor;
    if (!pageInfo?.hasNextPage || !nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return allTasks;
}

async function fetchAgentSessions(session, fromMs, toMs) {
  const data = await runGraphQL(session, buildSessionQuery(fromMs, toMs));
  return data?.agentSession?.agentSessions || [];
}

function toSeconds(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return value > 1000 ? value / 1000 : value;
}

function parseEpochish(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value > 1e12 ? value : value > 1e9 ? value * 1000 : 0;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric > 1e9 ? numeric * 1000 : 0;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getQueueWaitSeconds(task) {
  const explicit = toSeconds(Number(task?.queueDuration));
  if (explicit > 0) return explicit;
  const startedAt = parseEpochish(task?.createdTime);
  if (!startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
}

function getConnectedDurationSeconds(task) {
  return toSeconds(Number(task?.connectedDuration));
}

function isAbandonedTask(task) {
  const status = String(task?.status || '').toLowerCase();
  const terminationType = String(task?.terminationType || '').toLowerCase();
  return (
    status === 'abandoned' ||
    status === 'abandoned_in_queue' ||
    status === 'abandon' ||
    terminationType.includes('abandon')
  );
}

function isHandledTask(task) {
  if (isAbandonedTask(task)) return false;
  if (getConnectedDurationSeconds(task) > 0) return true;
  if (task?.owner?.id) return true;
  const status = String(task?.status || '').toLowerCase();
  return status === 'ended' || status === 'completed' || status === 'wrapup' || status === 'wrap_up';
}

function aggregateQueueTasks(parkedTasks) {
  const buckets = {};
  parkedTasks.forEach((task) => {
    const queueId = task?.lastQueue?.id || '';
    if (!queueId) return;
    if ((task?.status || '').toLowerCase() === 'connected') return;
    if (!buckets[queueId]) {
      buckets[queueId] = { queueId, waiting: 0, connected: 0, queueDurationSum: 0, withinThreshold: 0, longestWait: 0 };
    }
    const b = buckets[queueId];
    const qd = getQueueWaitSeconds(task);
    b.waiting += 1;
    b.queueDurationSum += qd;
    if (qd > b.longestWait) b.longestWait = qd;
    if (qd <= SERVICE_LEVEL_THRESHOLD_SEC) b.withinThreshold += 1;
  });
  return buckets;
}

function mergeConnectedCounts(activeAggregates, connectedTasks) {
  connectedTasks.forEach((task) => {
    const queueId = task?.lastQueue?.id || '';
    if (!queueId) return;
    if (!activeAggregates[queueId]) {
      activeAggregates[queueId] = { queueId, waiting: 0, connected: 0, queueDurationSum: 0, withinThreshold: 0, longestWait: 0 };
    }
    activeAggregates[queueId].connected += 1;
  });
  return activeAggregates;
}

function aggregateDailyTasks(allTasks) {
  const ACTIVE_STATUSES = new Set(['parked', 'connected', 'wrapup', 'wrap_up', 'reserved', 'ringing']);
  const buckets = {};
  allTasks.forEach((task) => {
    const queueId = task?.lastQueue?.id || '';
    if (!queueId) return;
    const status = (task?.status || '').toLowerCase();
    if (task?.isActive || ACTIVE_STATUSES.has(status)) return;
    if (!buckets[queueId]) buckets[queueId] = { queueId, handled: 0, abandoned: 0 };
    const b = buckets[queueId];
    if (isAbandonedTask(task)) b.abandoned += 1;
    else if (isHandledTask(task)) b.handled += 1;
  });
  return buckets;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

const STATE_BUCKETS = {
  available: ['AVAILABLE'],
  onCall: ['CONNECTED', 'TALKING', 'ON_CALL', 'HOLD', 'CONSULT', 'CONFERENCE'],
  ringing: ['RESERVED', 'RINGING'],
  wrapUp: ['WRAPUP', 'WRAP_UP', 'WRAP_UP_AGENT', 'POST_CALL'],
  idle: ['IDLE', 'NOT_RESPONDING', 'NOT_RESPONDED', 'RONA'],
};

function getSessionState(agentSession) {
  const ci = agentSession?.channelInfo;
  if (!ci) return '';
  const channels = Array.isArray(ci) ? ci : [ci];
  const ch = channels.find((c) => c?.channelType === 'telephony') || channels[0];
  return ch?.currentState || '';
}

function categorizeAgentState(state) {
  const normalized = (state || '').toString().toUpperCase();
  if (STATE_BUCKETS.available.includes(normalized)) return 'available';
  if (STATE_BUCKETS.onCall.includes(normalized)) return 'onCall';
  if (STATE_BUCKETS.ringing.includes(normalized)) return 'ringing';
  if (STATE_BUCKETS.wrapUp.includes(normalized)) return 'wrapUp';
  if (STATE_BUCKETS.idle.includes(normalized)) return 'idle';
  if (normalized) return 'idle';
  return 'offline';
}

function getStateBadgeLabel(stateValue) {
  const norm = (stateValue || '').toUpperCase();
  if (STATE_BUCKETS.available.includes(norm)) return 'Available';
  if (STATE_BUCKETS.onCall.includes(norm)) return 'Connected';
  if (STATE_BUCKETS.ringing.includes(norm)) return 'Ringing';
  if (STATE_BUCKETS.wrapUp.includes(norm)) return 'Wrap-up';
  if (STATE_BUCKETS.idle.includes(norm)) return 'Idle';
  if (norm === '') return 'Unknown';
  return stateValue;
}

function getSessionDurationSeconds(agentSession) {
  const channels = Array.isArray(agentSession?.channelInfo)
    ? agentSession.channelInfo
    : [agentSession?.channelInfo].filter(Boolean);
  const telCh = channels.find((c) => c?.channelType === 'telephony') || channels[0];
  const raw = telCh?.lastActivityTime ?? agentSession?.startTime;
  if (!raw) return 0;
  const ts = typeof raw === 'number' ? raw : Number(raw) > 0 ? Number(raw) : Date.parse(raw);
  if (!ts || Number.isNaN(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function getDashboard(session) {
  const ctx = await resolveAgentContext(session);
  const profile = await loadAgentProfile(session);
  const viewable = profile?.viewableStatistics || {};
  const queueIds = new Set(viewable.contactServiceQueues || []);
  const teamIds = new Set(viewable.teams || []);

  const now = Date.now();
  const fromMs = startOfToday();

  const [queueNamesResp, teamNamesResp, parkedTasks, connectedTasks, dailyTasks, sessions] = await Promise.all([
    queueIds.size
      ? authedFetch(
          session,
          `/organization/${ctx.orgId}/v3/contact-service-queue?filter=${encodeURIComponent(
            `id=in=(${[...queueIds].map((id) => `"${id}"`).join(',')})`
          )}`,
          { headers: { OrgId: ctx.orgId } }
        )
      : Promise.resolve(null),
    teamIds.size
      ? authedFetch(
          session,
          `/organization/${ctx.orgId}/v2/team?filter=${encodeURIComponent(
            `id=in=(${[...teamIds].map((id) => `"${id}"`).join(',')})`
          )}`
        )
      : Promise.resolve(null),
    fetchAllTaskPages(session, buildParkedTaskQuery, fromMs, now),
    fetchAllTaskPages(session, buildConnectedTaskQuery, fromMs, now),
    fetchAllTaskPages(session, buildDailyTaskQuery, fromMs, now),
    fetchAgentSessions(session, fromMs, now),
  ]);

  const queueNameById = new Map((queueNamesResp?.data || []).map((q) => [q.id, q.name || q.customName || q.id]));
  const teamNameById = new Map((teamNamesResp?.data || []).map((t) => [t.id, t.name || t.id]));

  const inScope = (task) => !queueIds.size || queueIds.has(task?.lastQueue?.id);
  const scopedParked = parkedTasks.filter(inScope);
  const scopedConnected = connectedTasks.filter(inScope);
  const scopedDaily = dailyTasks.filter(inScope);

  let activeAggregates = aggregateQueueTasks(scopedParked);
  activeAggregates = mergeConnectedCounts(activeAggregates, scopedConnected);
  const dailyAggregates = aggregateDailyTasks(scopedDaily);

  const queueRows = [...queueIds].map((queueId) => {
    const active = activeAggregates[queueId] || {};
    const daily = dailyAggregates[queueId] || {};
    const waiting = active.waiting || 0;
    const avgWaitSec = waiting ? active.queueDurationSum / waiting : 0;
    return {
      id: queueId,
      name: queueNameById.get(queueId) || queueId,
      waiting,
      avgWaitSec,
      longestWaitSec: active.longestWait || 0,
      handled: daily.handled || 0,
      abandoned: daily.abandoned || 0,
      connected: active.connected || 0,
    };
  });

  const totals = queueRows.reduce(
    (acc, r) => {
      acc.waiting += r.waiting;
      acc.handled += r.handled;
      acc.abandoned += r.abandoned;
      acc.connected += r.connected;
      if (r.longestWaitSec > acc.longestWaitSec) acc.longestWaitSec = r.longestWaitSec;
      return acc;
    },
    { waiting: 0, handled: 0, abandoned: 0, connected: 0, longestWaitSec: 0 }
  );

  const scopedSessions = sessions.filter((s) => !teamIds.size || teamIds.has(s?.teamId));
  const stateCounts = { available: 0, onCall: 0, ringing: 0, wrapUp: 0, idle: 0, offline: 0 };
  const agentRows = scopedSessions.map((s) => {
    const stateValue = getSessionState(s);
    const bucket = categorizeAgentState(stateValue);
    stateCounts[bucket] = (stateCounts[bucket] || 0) + 1;
    const channels = Array.isArray(s?.channelInfo) ? s.channelInfo : [s?.channelInfo].filter(Boolean);
    const telCh = channels.find((c) => c?.channelType === 'telephony') || channels[0];
    return {
      id: s?.agentId || `${s?.agentName}-${s?.teamId}`,
      team: teamNameById.get(s?.teamId) || s?.teamName || '—',
      agent: s?.agentName || '—',
      state: bucket,
      stateLabel: getStateBadgeLabel(stateValue),
      durationSec: getSessionDurationSeconds(s),
      idleCode: bucket === 'idle' ? telCh?.idleCodeName || '—' : '—',
      handled: telCh?.connectedCount ?? '—',
      rona: telCh?.ronaCount ?? '—',
    };
  });
  agentRows.sort((a, b) => a.team.localeCompare(b.team) || b.durationSec - a.durationSec);

  const selfRow = agentRows.find((r) => r.id === ctx.agentId);
  const self = selfRow
    ? {
        state: selfRow.state,
        stateLabel: selfRow.stateLabel,
        durationSec: selfRow.durationSec,
        idleCode: selfRow.idleCode,
      }
    : null;

  return {
    metrics: {
      waitingNow: totals.waiting,
      longestWait: formatTime(totals.longestWaitSec),
      totalHandled: totals.handled,
      connected: totals.connected,
      totalAbandoned: totals.abandoned,
    },
    queues: queueRows.map((r) => ({
      id: r.id,
      name: r.name,
      waiting: r.waiting,
      avgWait: formatTime(r.avgWaitSec),
      longestWait: formatTime(r.longestWaitSec),
      handled: r.handled,
      abandoned: r.abandoned,
      connected: r.connected,
    })),
    agents: agentRows.map((r) => ({
      id: r.id,
      team: r.team,
      agent: r.agent,
      state: r.state,
      stateLabel: r.stateLabel,
      duration: formatTime(r.durationSec),
      idleCode: r.idleCode,
      handled: r.handled,
      rona: r.rona,
    })),
    stateCounts,
    self,
  };
}
