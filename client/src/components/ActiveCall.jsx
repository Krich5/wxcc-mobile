import { useEffect, useState } from 'react';

function formatElapsed(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ActiveCall({ call }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!call) return null;

  const elapsedSec = (Date.now() - call.createdTimeMs) / 1000;

  return (
    <div className="active-call-card">
      <p className="active-call-label">Active call</p>
      <p className="active-call-number">{call.customerPhone || call.origin || 'Unknown caller'}</p>
      <p className="active-call-meta">
        {call.status} · {formatElapsed(elapsedSec)}
        {call.team ? ` · ${call.team}` : ''}
      </p>
    </div>
  );
}
