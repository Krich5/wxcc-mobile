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
  const [destNumber, setDestNumber] = useState('');
  // Set once the initial /consult succeeds -- while true, the original caller is on hold
  // (WxCC does this automatically via holdParticipants: true) and the agent is talking
  // to the consulted party on a separate leg -- shown as two separate cards.
  const [inConsult, setInConsult] = useState(false);
  const [consultTo, setConsultTo] = useState('');
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
      setDestNumber('');
      setInConsult(false);
      setConsultTo('');
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
    setPendingAction((current) => (current === action ? null : action));
  };

  const submitPendingAction = async () => {
    const to = destNumber.trim();
    if (!to) return;
    const ok = await runAction(pendingAction, { body: JSON.stringify({ to }) });
    if (ok) {
      if (pendingAction === 'consult') {
        setInConsult(true);
        setConsultTo(to);
        setConsultStartedAtMs(Date.now());
      } else if (pendingAction === 'transfer') {
        // A completed transfer hands the call off entirely -- confirmed the moment this
        // API call succeeds, no need to wait for the next poll to notice.
        onEnded?.(call.id);
      }
      setPendingAction(null);
      setDestNumber('');
    }
  };

  const completeConsultTransfer = async () => {
    const ok = await runAction('consult/transfer', { body: JSON.stringify({ to: consultTo }) });
    if (ok) onEnded?.(call.id);
  };

  const mergeConsult = async () => {
    const ok = await runAction('consult/conference', { body: JSON.stringify({ to: consultTo }) });
    if (ok) {
      setInConsult(false);
      setConsultTo('');
      setConsultStartedAtMs(null);
    }
  };

  const endConsult = async () => {
    const ok = await runAction('consult/end', { body: JSON.stringify({}) });
    if (ok) {
      setInConsult(false);
      setConsultTo('');
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
          <p className="active-call-number">{consultTo}</p>
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
              <input
                type="tel"
                placeholder="Destination number"
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
                  setDestNumber('');
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
