import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Cisco's own Momentum Design icon set (momentum.design/icons/*-bold.svg) -- kept as raw
// path data rather than an icon-library dependency since only these six are needed.
function HandsetIcon() {
  return (
    <svg viewBox="0 0 32 32" width="20" height="20" fill="currentColor">
      <path d="m28.134 21.413-2.806-2.81a3.5 3.5 0 0 0-4.954.006s-1.212 1.234-1.725 1.752a7.3 7.3 0 0 1-7.04-7.049c.516-.513 1.75-1.727 1.755-1.732a3.506 3.506 0 0 0 0-4.956l-2.806-2.81a3.59 3.59 0 0 0-4.967 0l-1.5 1.502C2.066 7.344 1.588 14.443 9.553 22.42c4.28 4.285 8.056 5.857 10.47 6.42.875.209 1.77.318 2.67.324 1.429.1 2.841-.357 3.94-1.276l1.501-1.5a3.523 3.523 0 0 0 0-4.975m-1.33 3.641-1.5 1.503c-.616.616-2.397 1.021-4.854.448-2.175-.508-5.6-1.946-9.566-5.917-7.08-7.091-6.78-13.12-5.463-14.44l1.5-1.502a1.67 1.67 0 0 1 2.306 0l2.806 2.81a1.62 1.62 0 0 1 .006 2.286s-1.534 1.509-1.903 1.88a1.77 1.77 0 0 0-.408 1.315 9.46 9.46 0 0 0 2.683 6.12c2.453 2.458 6.481 3.229 7.425 2.28.37-.37 1.872-1.9 1.874-1.901a1.62 1.62 0 0 1 2.287 0l2.807 2.81a1.636 1.636 0 0 1 0 2.309" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor">
      <path d="M10 4a4.004 4.004 0 0 0-4 4v16a4 4 0 0 0 8 0V8a4.004 4.004 0 0 0-4-4m2 20a2 2 0 1 1-4 0V8a2 2 0 1 1 4 0zM22 4a4.004 4.004 0 0 0-4 4v16a4 4 0 1 0 8 0V8a4.004 4.004 0 0 0-4-4m2 20a2 2 0 1 1-4 0V8a2 2 0 1 1 4 0z" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor">
      <path d="M30 15.008a5.014 5.014 0 0 0-4.187-4.913 9.998 9.998 0 0 0-19.628-.012 4.996 4.996 0 0 0 .818 9.925 1 1 0 0 0 1-1.003L8 12a8 8 0 0 1 16 0v6a8.01 8.01 0 0 1-5.388 7.553 2.986 2.986 0 1 0 .332 2.003 10.03 10.03 0 0 0 6.865-7.643A5.01 5.01 0 0 0 30 15.008M6 17.837a2.992 2.992 0 0 1 0-5.645zM16 28a1 1 0 1 1 0-2 1 1 0 0 1 0 2m10-10.195v-5.602a2.96 2.96 0 0 1 0 5.602" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor">
      <path d="m29.708 15.293-10-10a1 1 0 0 0-1.414 1.414L26.586 15H3a1 1 0 0 0 0 2h23.586l-8.293 8.293a1 1 0 1 0 1.414 1.414l10-10a1 1 0 0 0 0-1.415" />
    </svg>
  );
}

function RecordPausedIcon() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor">
      <path d="M14.269 20.333a2.64 2.64 0 0 1-1.767.666c-.663 0-1.299-.24-1.768-.666a2.17 2.17 0 0 1-.732-1.606v-5.455c0-.603.263-1.18.732-1.607a2.63 2.63 0 0 1 1.768-.666c.662 0 1.298.24 1.767.666.47.426.732 1.004.732 1.607v5.455c0 .602-.264 1.18-.732 1.606m-2.121-7.382a.43.43 0 0 0-.146.32v5.456c0 .12.052.236.146.32a.53.53 0 0 0 .354.134c.132 0 .259-.048.353-.133a.44.44 0 0 0 .146-.321v-5.455a.43.43 0 0 0-.146-.321.53.53 0 0 0-.354-.134.53.53 0 0 0-.353.134M17.733 11.666A2.64 2.64 0 0 1 19.5 11c.662 0 1.298.24 1.767.666S22 12.67 22 13.272v5.455c0 .603-.263 1.18-.732 1.607a2.63 2.63 0 0 1-1.768.665c-.663 0-1.298-.239-1.767-.665A2.17 2.17 0 0 1 17 18.727v-5.455c.001-.602.265-1.18.733-1.606m2.12 7.382a.44.44 0 0 0 .147-.321v-5.455a.44.44 0 0 0-.146-.321.53.53 0 0 0-.354-.134.53.53 0 0 0-.353.134.43.43 0 0 0-.146.32v5.456c0 .12.052.236.146.32a.53.53 0 0 0 .354.134c.132 0 .26-.048.353-.133M8.223 4.36A14 14 0 0 1 16 2a14.016 14.016 0 0 1 14 14A14 14 0 1 1 8.223 4.36m1.11 21.618A12 12 0 0 0 16 28a12.01 12.01 0 0 0 12-12 12 12 0 1 0-18.666 9.978" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor">
      <path d="m17.414 16 8.293-8.293a1 1 0 0 0-1.414-1.414L16 14.586 7.707 6.293a1 1 0 1 0-1.414 1.414L14.586 16l-8.293 8.293a1 1 0 0 0 1.414 1.414L16 17.414l8.293 8.293a1 1 0 0 0 1.414-1.414z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor">
      <path d="M7.981 27.997a3 3 0 0 1-2.985-2.999V7.002A3 3 0 0 1 9.337 4.32l16.033 9.008a3 3 0 0 1-.024 5.356L9.38 27.659c-.434.22-.912.336-1.399.338M8.01 5.993a1.05 1.05 0 0 0-.89.522 1 1 0 0 0-.124.487v17.996a1 1 0 0 0 1.447.895l15.966-8.976a1.005 1.005 0 0 0 .449-1.444 1 1 0 0 0-.406-.367l-.043-.023L8.4 6.086a.9.9 0 0 0-.39-.093" />
    </svg>
  );
}

function RecordIcon() {
  return (
    <svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor">
      <path d="M16 2a14 14 0 1 0 14 14A14.016 14.016 0 0 0 16 2m0 26a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12M16 11a5 5 0 1 0 5 5 5.006 5.006 0 0 0-5-5m0 8a3 3 0 1 1 0-5.999 3 3 0 0 1 0 6" />
    </svg>
  );
}

function formatElapsed(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ActiveCall({ call, onEnded, onActionTaken, self, fetchedAtMs }) {
  const [, forceTick] = useState(0);
  const [onHold, setOnHold] = useState(false);
  // Purely optimistic -- unlike Hold, there's no confirmed field on the polled call/task
  // data to reconcile a recording-paused state against, so this just reflects the last
  // button the agent pressed.
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'consult' | 'transfer' | null
  const [destType, setDestType] = useState('dialNumber'); // 'dialNumber' | 'agent' | 'entryPoint'
  const [destNumber, setDestNumber] = useState('');
  const [agentId, setAgentId] = useState('');
  const [entryPointId, setEntryPointId] = useState('');
  // Lazily loaded (and cached) the first time the agent switches to the Agent tab --
  // agent-profile.buddyTeams/userIds rarely change mid-shift, so no need to re-fetch per
  // call.
  const [agents, setAgents] = useState(null);
  const [agentsError, setAgentsError] = useState(null);
  // Same lazy-load-and-cache pattern as agents -- the org's entry points don't change
  // mid-shift either.
  const [entryPoints, setEntryPoints] = useState(null);
  const [entryPointsError, setEntryPointsError] = useState(null);
  // Same lazy-load-and-cache pattern as agents -- the org address book doesn't change
  // mid-shift either.
  const [addressBook, setAddressBook] = useState(null);
  const [addressBookError, setAddressBookError] = useState(null);
  // Set once the initial /consult succeeds -- while true, the original caller is on hold
  // (WxCC does this automatically via holdParticipants: true) and the agent is talking
  // to the consulted party on a separate leg -- shown as two separate cards.
  const [inConsult, setInConsult] = useState(false);
  const [consultTo, setConsultTo] = useState('');
  const [consultDestType, setConsultDestType] = useState('dialNumber');
  const [consultLabel, setConsultLabel] = useState('');
  const [consultStartedAtMs, setConsultStartedAtMs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lastCallIdRef = useRef(null);

  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  // Reconcile the Hold/Unhold toggle against the server-confirmed status on every poll
  // (rather than trusting only our own optimistic toggle) -- statusLabel comes from the
  // same search API/taskDetails.status this app already treats as source of truth
  // elsewhere.
  useEffect(() => {
    if (!call) return;
    const reallyOnHold = call.statusLabel === 'On Hold';
    setOnHold((prev) => (prev === reallyOnHold ? prev : reallyOnHold));
  }, [call?.statusLabel]);

  // Consult state isn't in the search-API response we poll -- track it locally, and
  // reset it whenever we start tracking a different call, so stale state can't leak from
  // one call into the next.
  useEffect(() => {
    if ((call?.id || null) !== lastCallIdRef.current) {
      lastCallIdRef.current = call?.id || null;
      setPendingAction(null);
      setDestType('dialNumber');
      setDestNumber('');
      setAgentId('');
      setEntryPointId('');
      setInConsult(false);
      setConsultTo('');
      setConsultLabel('');
      setConsultStartedAtMs(null);
      setRecordingPaused(false);
      setError(null);
    }
  }, [call?.id]);

  if (!call) return null;
  // A parked call is deliberately set aside (usually for another agent/queue to pick up
  // later) -- it's not something THIS agent needs to act on right now, so it shouldn't
  // keep floating on screen as if it still needed attention the way an active call does.
  if ((call.statusLabel || '').toLowerCase() === 'parked') return null;

  // Ringing calls aren't answered through this app (the agent's own phone rings) -- call
  // controls only make sense once the call is actually engaged (including on hold --
  // that's still an active call the agent needs Unhold/Transfer/End for, not a reason
  // to hide the whole control row).
  const engaged = call.statusLabel === 'Engaged' || call.statusLabel === 'On Hold';
  // Same source (and same number) as the Agent State roster's own duration for this
  // agent -- durationSec resets on every state transition (including on/off hold), so
  // this can't show a different "how long" than the roster does. Falls back to time-
  // since-created only before the very first self poll lands (e.g. while still ringing).
  const elapsedSec =
    engaged && self && fetchedAtMs != null
      ? self.durationSec + (Date.now() - fetchedAtMs) / 1000
      : (Date.now() - call.createdTimeMs) / 1000;
  const consultElapsedSec = consultStartedAtMs ? (Date.now() - consultStartedAtMs) / 1000 : 0;

  const runAction = async (path, opts) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/agent/tasks/${call.id}/${path}`, { method: 'POST', ...opts });
      // Re-poll right away instead of waiting up to POLL_MS for the next scheduled
      // check -- every control here should feel instant, not laggy.
      onActionTaken?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleHold = async () => {
    const ok = await runAction(onHold ? 'unhold' : 'hold');
    if (ok) setOnHold(!onHold);
  };

  const toggleRecording = async () => {
    const ok = await runAction(recordingPaused ? 'record/resume' : 'record/pause');
    if (ok) setRecordingPaused(!recordingPaused);
  };

  const endCall = async () => {
    const ok = await runAction('end');
    // Don't wait for the next poll to notice the call is gone -- the API call
    // succeeding already IS the confirmation.
    if (ok) onEnded?.(call.id);
  };

  const togglePendingAction = (action) => {
    setError(null);
    setDestType('dialNumber');
    setDestNumber('');
    setAgentId('');
    setEntryPointId('');
    setPendingAction((current) => (current === action ? null : action));
    if (addressBook === null && !addressBookError) {
      api('/api/agent/address-book')
        .then(({ entries }) => setAddressBook(entries || []))
        .catch((err) => {
          setAddressBookError(err.message);
          setAddressBook([]);
        });
    }
  };

  const selectAgentType = () => {
    setDestType('agent');
    if (agents === null && !agentsError) {
      // No state filter -- fetch both Available and Idle once; which ones are
      // selectable depends on whether this is a consult (either) or a transfer
      // (Available only), applied client-side in visibleAgents below.
      api('/api/agent/consult-agents', { method: 'POST', body: JSON.stringify({}) })
        .then(({ agents: list }) => setAgents(list || []))
        .catch((err) => {
          setAgentsError(err.message);
          setAgents([]);
        });
    }
  };

  const selectEntryPointType = () => {
    setDestType('entryPoint');
    if (entryPoints === null && !entryPointsError) {
      api('/api/agent/entry-points')
        .then(({ entryPoints: list }) => setEntryPoints(list || []))
        .catch((err) => {
          setEntryPointsError(err.message);
          setEntryPoints([]);
        });
    }
  };

  const isAgentAvailable = (a) => a.state?.toLowerCase() === 'available';
  // Consulting an idle agent is supported; transferring is not -- restrict the picker
  // accordingly rather than let the agent pick a target that's guaranteed to fail.
  const visibleAgents = (agents || []).filter((a) => pendingAction === 'consult' || isAgentAvailable(a));

  const submitPendingAction = async () => {
    const to = destType === 'agent' ? agentId : destType === 'entryPoint' ? entryPointId : destNumber.trim();
    if (!to) return;
    const label =
      destType === 'agent'
        ? agents?.find((a) => a.id === to)?.name || to
        : destType === 'entryPoint'
          ? entryPoints?.find((e) => e.id === to)?.name || to
          : addressBook?.find((e) => e.number === to)?.name || to;
    const ok = await runAction(pendingAction, { body: JSON.stringify({ to, destinationType: destType }) });
    if (ok) {
      if (pendingAction === 'consult') {
        setInConsult(true);
        setConsultTo(to);
        setConsultDestType(destType);
        setConsultLabel(label);
        setConsultStartedAtMs(Date.now());
      } else if (pendingAction === 'transfer') {
        // A completed transfer hands the call off entirely -- confirmed the moment this
        // API call succeeds, no need to wait for the next poll to notice.
        onEnded?.(call.id);
      }
      setPendingAction(null);
      setDestType('dialNumber');
      setDestNumber('');
      setAgentId('');
      setEntryPointId('');
    }
  };

  // Filtered as the agent types -- matches name or number, capped so the list stays
  // scannable rather than dumping the whole address book under the input.
  const addressBookMatches =
    destType === 'dialNumber' && destNumber.trim() && addressBook
      ? addressBook
          .filter((e) => {
            const q = destNumber.trim().toLowerCase();
            return e.name?.toLowerCase().includes(q) || e.number?.includes(destNumber.trim());
          })
          .slice(0, 8)
      : [];

  const completeConsultTransfer = async () => {
    const ok = await runAction('consult/transfer', {
      body: JSON.stringify({ to: consultTo, destinationType: consultDestType }),
    });
    if (ok) onEnded?.(call.id);
  };

  const mergeConsult = async () => {
    const ok = await runAction('consult/conference', {
      body: JSON.stringify({ to: consultTo, destinationType: consultDestType }),
    });
    if (ok) {
      setInConsult(false);
      setConsultTo('');
      setConsultLabel('');
      setConsultStartedAtMs(null);
    }
  };

  const endConsult = async () => {
    const ok = await runAction('consult/end', { body: JSON.stringify({}) });
    if (ok) {
      setInConsult(false);
      setConsultTo('');
      setConsultLabel('');
      setConsultStartedAtMs(null);
    }
  };

  if (inConsult) {
    return (
      <div className="active-call-stack">
        <div className="active-call-card">
          <div className="active-call-header">
            <div className="active-call-icon">
              <HandsetIcon />
            </div>
            <div>
              <p className="active-call-number">{call.customerPhone || call.origin || 'Unknown caller'}</p>
              <p className="active-call-meta">On Hold - {formatElapsed(elapsedSec)}</p>
            </div>
          </div>
        </div>
        <div className="active-call-card">
          <div className="active-call-header">
            <div className="active-call-icon">
              <HandsetIcon />
            </div>
            <div>
              <p className="active-call-number">{consultLabel}</p>
              <p className="active-call-meta">Consult - {formatElapsed(consultElapsedSec)}</p>
            </div>
          </div>
          <div className="active-call-actions">
            <button className="pill" onClick={completeConsultTransfer} disabled={busy}>
              Transfer
            </button>
            <button className="pill" onClick={mergeConsult} disabled={busy}>
              Merge
            </button>
            <button className="pill end-pill" onClick={endConsult} disabled={busy}>
              End Consult
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="active-call-card">
      {engaged && (
        <span className="active-call-rec" title={recordingPaused ? 'Recording paused' : 'Recording'}>
          {recordingPaused ? <PauseIcon /> : <RecordIcon />}
        </span>
      )}
      <div className="active-call-header">
        <div className="active-call-icon">
          <HandsetIcon />
        </div>
        <div>
          <p className="active-call-number">{call.customerPhone || call.origin || 'Unknown caller'}</p>
          <p className="active-call-meta">
            {call.statusLabel} - {formatElapsed(elapsedSec)}
          </p>
        </div>
      </div>

      {engaged && (
        <>
          <div className="active-call-actions">
            <button
              type="button"
              className="call-icon-btn"
              onClick={toggleHold}
              disabled={busy}
              aria-label={onHold ? 'Unhold' : 'Hold'}
              title={onHold ? 'Unhold' : 'Hold'}
            >
              {onHold ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              className={`call-icon-btn ${pendingAction === 'consult' ? 'active' : ''}`}
              onClick={() => togglePendingAction('consult')}
              disabled={busy}
              aria-label="Consult"
              title="Consult"
            >
              <HeadsetIcon />
            </button>
            <button
              type="button"
              className={`call-icon-btn ${pendingAction === 'transfer' ? 'active' : ''}`}
              onClick={() => togglePendingAction('transfer')}
              disabled={busy}
              aria-label="Transfer"
              title="Transfer"
            >
              <NextIcon />
            </button>
            <button
              type="button"
              className="call-icon-btn"
              onClick={toggleRecording}
              disabled={busy}
              aria-label={recordingPaused ? 'Resume Recording' : 'Pause Recording'}
              title={recordingPaused ? 'Resume Recording' : 'Pause Recording'}
            >
              <RecordPausedIcon />
            </button>
            <button
              type="button"
              className="call-icon-btn end"
              onClick={endCall}
              disabled={busy}
              aria-label="End"
              title="End"
            >
              <CancelIcon />
            </button>
          </div>

          <div className="active-call-fields">
            {call.team && (
              <p>
                <strong>Queue:</strong> {call.team}
              </p>
            )}
            <p>
              <strong>Phone Number:</strong> {call.customerPhone || call.origin || 'Unknown caller'}
            </p>
          </div>

          {pendingAction && (
            <div className="active-call-dest">
              <div className="active-call-dest-row">
                <button
                  type="button"
                  className={`pill ${destType === 'dialNumber' ? 'active' : ''}`}
                  onClick={() => setDestType('dialNumber')}
                >
                  Number
                </button>
                <button type="button" className={`pill ${destType === 'agent' ? 'active' : ''}`} onClick={selectAgentType}>
                  Agent
                </button>
                <button
                  type="button"
                  className={`pill ${destType === 'entryPoint' ? 'active' : ''}`}
                  onClick={selectEntryPointType}
                >
                  Entry Point
                </button>
              </div>

              {destType === 'dialNumber' ? (
                <>
                  <div className="active-call-dest-row">
                    <input
                      type="tel"
                      placeholder="Search address book or enter a number"
                      value={destNumber}
                      onChange={(e) => setDestNumber(e.target.value)}
                      autoFocus
                    />
                    <button className="primary" onClick={submitPendingAction} disabled={busy || !destNumber.trim()}>
                      {pendingAction === 'consult' ? 'Consult' : 'Transfer'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setPendingAction(null);
                        setDestType('dialNumber');
                        setDestNumber('');
                        setAgentId('');
                        setEntryPointId('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {addressBookMatches.length > 0 && (
                    <ul className="address-book-suggestions">
                      {addressBookMatches.map((e) => (
                        <li key={e.id} onClick={() => setDestNumber(e.number)}>
                          <span className="address-book-name">{e.name}</span>
                          <span className="address-book-number">{e.number}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {addressBookError && <p className="error">{addressBookError}</p>}
                </>
              ) : destType === 'agent' ? (
                <>
                  {agentsError && <p className="error">{agentsError}</p>}
                  {!agentsError && agents === null && <p className="hint">Loading agents…</p>}
                  {!agentsError && agents !== null && visibleAgents.length === 0 && (
                    <p className="hint">
                      {pendingAction === 'transfer' ? 'No agents are Available right now.' : 'No agents found.'}
                    </p>
                  )}
                  {visibleAgents.length > 0 && (
                    <ul className="agent-picker-list">
                      {visibleAgents.map((a) => (
                        <li
                          key={a.id}
                          className={agentId === a.id ? 'active' : ''}
                          onClick={() => setAgentId(a.id)}
                        >
                          <span className={`agent-dot ${isAgentAvailable(a) ? 'is-available' : 'is-idle'}`} />
                          <span className="agent-picker-name">{a.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="active-call-dest-row">
                    <button className="primary" onClick={submitPendingAction} disabled={busy || !agentId}>
                      {pendingAction === 'consult' ? 'Consult' : 'Transfer'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setPendingAction(null);
                        setDestType('dialNumber');
                        setDestNumber('');
                        setAgentId('');
                        setEntryPointId('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {entryPointsError && <p className="error">{entryPointsError}</p>}
                  {!entryPointsError && entryPoints === null && <p className="hint">Loading entry points…</p>}
                  {!entryPointsError && entryPoints !== null && entryPoints.length === 0 && (
                    <p className="hint">No entry points found.</p>
                  )}
                  {entryPoints?.length > 0 && (
                    <ul className="agent-picker-list">
                      {entryPoints.map((e) => (
                        <li
                          key={e.id}
                          className={entryPointId === e.id ? 'active' : ''}
                          onClick={() => setEntryPointId(e.id)}
                        >
                          <span className="agent-picker-name">{e.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="active-call-dest-row">
                    <button className="primary" onClick={submitPendingAction} disabled={busy || !entryPointId}>
                      {pendingAction === 'consult' ? 'Consult' : 'Transfer'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setPendingAction(null);
                        setDestType('dialNumber');
                        setDestNumber('');
                        setAgentId('');
                        setEntryPointId('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
