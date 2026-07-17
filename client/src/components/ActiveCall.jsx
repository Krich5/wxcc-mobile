import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

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
  const [pendingAction, setPendingAction] = useState(null); // 'consult' | 'transfer' | null
  const [destType, setDestType] = useState('dialNumber'); // 'dialNumber' | 'agent'
  const [destNumber, setDestNumber] = useState('');
  const [agentId, setAgentId] = useState('');
  // Lazily loaded (and cached) the first time the agent switches to the Agent tab --
  // agent-profile.buddyTeams/userIds rarely change mid-shift, so no need to re-fetch per
  // call.
  const [agents, setAgents] = useState(null);
  const [agentsError, setAgentsError] = useState(null);
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
      setInConsult(false);
      setConsultTo('');
      setConsultLabel('');
      setConsultStartedAtMs(null);
      setError(null);
    }
  }, [call?.id]);

  if (!call) return null;

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

  const isAgentAvailable = (a) => a.state?.toLowerCase() === 'available';
  // Consulting an idle agent is supported; transferring is not -- restrict the picker
  // accordingly rather than let the agent pick a target that's guaranteed to fail.
  const visibleAgents = (agents || []).filter((a) => pendingAction === 'consult' || isAgentAvailable(a));

  const submitPendingAction = async () => {
    const to = destType === 'agent' ? agentId : destNumber.trim();
    if (!to) return;
    const label =
      destType === 'agent'
        ? agents?.find((a) => a.id === to)?.name || to
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
          <p className="active-call-label">On Hold</p>
          <p className="active-call-number">{call.customerPhone || call.origin || 'Unknown caller'}</p>
          <p className="active-call-meta">
            On Hold · {formatElapsed(elapsedSec)}
            {call.team ? ` · ${call.team}` : ''}
          </p>
        </div>
        <div className="active-call-card">
          <p className="active-call-label">Consulting</p>
          <p className="active-call-number">{consultLabel}</p>
          <p className="active-call-meta">Consult · {formatElapsed(consultElapsedSec)}</p>
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
      <p className="active-call-label">{call.statusLabel}</p>
      <p className="active-call-number">{call.customerPhone || call.origin || 'Unknown caller'}</p>
      <p className="active-call-meta">
        {call.statusLabel} · {formatElapsed(elapsedSec)}
        {call.team ? ` · ${call.team}` : ''}
      </p>

      {engaged && (
        <>
          <div className="active-call-actions">
            <button className="pill" onClick={toggleHold} disabled={busy}>
              {onHold ? 'Unhold' : 'Hold'}
            </button>
            <button
              className={`pill ${pendingAction === 'consult' ? 'active' : ''}`}
              onClick={() => togglePendingAction('consult')}
              disabled={busy}
            >
              Consult
            </button>
            <button
              className={`pill ${pendingAction === 'transfer' ? 'active' : ''}`}
              onClick={() => togglePendingAction('transfer')}
              disabled={busy}
            >
              Transfer
            </button>
            <button className="pill end-pill" onClick={endCall} disabled={busy}>
              End
            </button>
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
              ) : (
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
