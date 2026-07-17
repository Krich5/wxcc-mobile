import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const POLL_MS = 15000;

const STAT_CARDS = [
  { key: 'waitingNow', label: 'Waiting Now' },
  { key: 'longestWait', label: 'Longest In Queue' },
  { key: 'totalHandled', label: 'Total Handled' },
  { key: 'totalAbandoned', label: 'Total Abandoned' },
];

// Fixed order/colors matching the state-badge classes used elsewhere in the app --
// identity is never color-alone here: each slice also gets a legend swatch + label + count.
const STATE_SLICES = [
  { key: 'available', label: 'Available', color: 'var(--success)' },
  { key: 'onCall', label: 'Connected', color: 'var(--amber)' },
  { key: 'wrapUp', label: 'Wrap-up', color: 'var(--wrapup)' },
  { key: 'idle', label: 'Idle', color: 'var(--danger)' },
];

function StateDonut({ stateCounts }) {
  const idleTotal = (stateCounts.idle || 0) + (stateCounts.offline || 0);
  const counts = { ...stateCounts, idle: idleTotal };
  const total = STATE_SLICES.reduce((sum, s) => sum + (counts[s.key] || 0), 0);

  let cursor = 0;
  const stops = STATE_SLICES.map((s) => {
    const value = counts[s.key] || 0;
    const start = total ? (cursor / total) * 100 : 0;
    cursor += value;
    const end = total ? (cursor / total) * 100 : 0;
    return `${s.color} ${start}% ${end}%`;
  }).join(', ');

  return (
    <div className="state-donut-block">
      <div
        className="state-donut"
        style={{ background: total ? `conic-gradient(${stops})` : 'var(--bg-elevated)' }}
      >
        <div className="state-donut-hole">
          <span className="state-donut-total">{total}</span>
          <span className="state-donut-total-label">Agents</span>
        </div>
      </div>
      <ul className="state-legend">
        {STATE_SLICES.map((s) => (
          <li key={s.key}>
            <span className="state-legend-swatch" style={{ background: s.color }} />
            {s.label}: {counts[s.key] || 0}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Dashboard({ refreshSignal }) {
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (session.mode !== 'live') return;
    let cancelled = false;
    const load = () => {
      api('/api/agent/dashboard')
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // refreshSignal isn't read here -- it's a bump-only counter from a presence change so
    // this roster poll and the header pill's own poll land close together instead of
    // drifting on two fully independent 15s cycles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mode, refreshSignal]);

  if (session.mode !== 'live') return null;
  if (error) return <p className="hint">Couldn't load the dashboard: {error}</p>;
  if (!data) return <p className="hint">Loading dashboard…</p>;

  const { metrics, agents, stateCounts } = data;

  return (
    <div className="dashboard">
      <div className="stat-cards">
        {STAT_CARDS.map(({ key, label }) => (
          <div key={key} className="stat-card">
            <p className="stat-card-label">{label}</p>
            <p className="stat-card-value">{metrics[key]}</p>
          </div>
        ))}
      </div>

      <div className="dashboard-section">
        <p className="dashboard-section-title">Agent State</p>
        {agents.length > 0 ? (
          <div className="agent-cards">
            {agents.map((a) => (
              <div key={a.id} className="agent-card">
                <div className="agent-card-row">
                  <span className="agent-card-name">{a.agent}</span>
                  <span className={`state-badge state-badge-${a.state}`}>{a.stateLabel}</span>
                </div>
                <div className="agent-card-row agent-card-meta">
                  <span>{a.duration}</span>
                  <span>{a.idleCode}</span>
                  <span>Handled {a.handled}</span>
                  <span>RONA {a.rona}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">No agents currently active.</p>
        )}
        <StateDonut stateCounts={stateCounts} />
      </div>
    </div>
  );
}
