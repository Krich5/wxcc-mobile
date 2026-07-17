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

export function CallLog({ onClose }) {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/agent/call-log')
      .then(({ calls: list }) => setCalls(list))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="call-log-view">
      <div className="call-log-view-header">
        <h2>Call Log</h2>
        <button className="call-log-close" onClick={onClose} aria-label="Back to dashboard">
          &times;
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!calls && !error && <p className="hint">Loading…</p>}
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
                <span>Talk {formatDuration(c.talkSec)}</span>
                {c.holdSec > 0 && <span>Hold {formatDuration(c.holdSec)}</span>}
                {c.consultSec > 0 && <span>Consult {formatDuration(c.consultSec)}</span>}
                {c.conferenceSec > 0 && <span>Conf {formatDuration(c.conferenceSec)}</span>}
                {c.wrapupSec > 0 && <span>Wrap {formatDuration(c.wrapupSec)}</span>}
              </div>
              {c.wrapUpCode && <p className="call-log-row-code">{c.wrapUpCode}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
