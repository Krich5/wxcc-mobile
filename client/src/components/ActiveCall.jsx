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

export function ActiveCall({ call }) {
  const [, forceTick] = useState(0);
  const [onHold, setOnHold] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'consult' | 'transfer' | null
  const [destNumber, setDestNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lastCallIdRef = useRef(null);

  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  // Hold state isn't in the search-API response we poll -- track it locally, and reset
  // it (along with any pending consult/transfer) whenever we start tracking a different
  // call, so stale "on hold"/open-input state can't leak from one call into the next.
  useEffect(() => {
    if ((call?.id || null) !== lastCallIdRef.current) {
      lastCallIdRef.current = call?.id || null;
      setOnHold(false);
      setPendingAction(null);
      setDestNumber('');
      setError(null);
    }
  }, [call?.id]);

  if (!call) return null;

  const elapsedSec = (Date.now() - call.createdTimeMs) / 1000;

  const runAction = async (path, opts) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/agent/tasks/${call.id}/${path}`, { method: 'POST', ...opts });
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

  const endCall = () => runAction('end');

  const togglePendingAction = (action) => {
    setError(null);
    setPendingAction((current) => (current === action ? null : action));
  };

  const submitPendingAction = async () => {
    const to = destNumber.trim();
    if (!to) return;
    const ok = await runAction(pendingAction, { body: JSON.stringify({ to }) });
    if (ok) {
      setPendingAction(null);
      setDestNumber('');
    }
  };

  // Ringing calls aren't answered through this app (the agent's own phone rings) -- call
  // controls only make sense once the call is actually engaged.
  const engaged = call.statusLabel === 'Engaged';

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
