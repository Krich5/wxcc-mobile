import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatWhen(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function CallLogModal({ onClose }) {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/agent/call-log')
      .then(({ calls: list }) => setCalls(list))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card call-log" onClick={(e) => e.stopPropagation()}>
        <h2>Call Log</h2>
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
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
