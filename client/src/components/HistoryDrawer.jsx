import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatWhen(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A left-edge drawer -- one handle both opens and closes it, rather than a separate
// backdrop/close button -- showing the currently active call (if any) above the same
// past-calls list the full-screen Call Log already renders, so an agent can check "what's
// happening now + what just happened" without leaving whatever else is on screen.
export function HistoryDrawer({ call, headerHeight = 0 }) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!open || calls !== null) return;
    api('/api/agent/call-log')
      .then(({ calls: list }) => setCalls(list))
      .catch((err) => setError(err.message));
  }, [open, calls]);

  useEffect(() => {
    if (!open || !call) return;
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [open, call]);

  const activeElapsedSec = call ? (Date.now() - call.createdTimeMs) / 1000 : 0;

  return (
    <>
      <button
        type="button"
        className={`history-drawer-tab ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close call history' : 'Open call history'}
      >
        <span>{open ? '‹' : '›'}</span>
      </button>
      <div className={`history-drawer ${open ? 'open' : ''}`} style={{ top: headerHeight }}>
        <h2 className="history-drawer-title">Calls</h2>

        {call && (
          <>
            <p className="history-drawer-section-label">Active</p>
            <div className="call-log-row">
              <div className="call-log-row-top">
                <span className="call-log-caller">{call.customerPhone || call.origin || 'Unknown caller'}</span>
                <span className="call-log-when">{formatDuration(activeElapsedSec)}</span>
              </div>
              <div className="call-log-row-meta">
                <span>{call.statusLabel}</span>
                {call.team ? <span> · {call.team}</span> : null}
              </div>
            </div>
          </>
        )}

        <p className="history-drawer-section-label">History</p>
        {error && <p className="error">{error}</p>}
        {open && !calls && !error && <p className="hint">Loading…</p>}
        {calls && calls.length === 0 && <p className="hint">No recent calls.</p>}
        {calls && calls.length > 0 && (
          <div className="call-log-list">
            {calls.map((c) => (
              <div key={c.id} className="call-log-row">
                <div className="call-log-row-top">
                  <span className="call-log-caller">{c.caller}</span>
                  <span className="call-log-when">{formatWhen(c.createdTimeMs)}</span>
                </div>
                <div className="call-log-row-meta">
                  <span>Total {formatDuration(c.totalSec)}</span>
                </div>
                {c.wrapUpCode && <p className="call-log-row-code">Wrap up code: {c.wrapUpCode}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
