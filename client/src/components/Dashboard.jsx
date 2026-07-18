import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { formatElapsed } from '../lib/time.js';

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

export function Dashboard({ data, error, fetchedAtMs }) {
  const { session } = useSession();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

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
            {agents.map((a) => {
              // Ticked client-side from the same raw durationSec/totalIdleSec + fetchedAtMs
              // the header pill uses (both now come from the one shared dashboard poll) --
              // this is the only way a roster row can never show a different number than
              // the header for the signed-in agent's own row, even between polls.
              const elapsedSinceFetch = fetchedAtMs != null ? (Date.now() - fetchedAtMs) / 1000 : 0;
              const duration = formatElapsed(a.durationSec + elapsedSinceFetch);
              // Time in THIS reason (above) resets on every idle-code switch; total idle
              // time (below) is cumulative across the whole idle stretch -- only meaningful
              // while actually idle, mirroring Cisco's own supervisor Team Performance view.
              const totalIdle = a.totalIdleSec != null ? formatElapsed(a.totalIdleSec + elapsedSinceFetch) : null;
              return (
                <div key={a.id} className="agent-card">
                  <div className="agent-card-row">
                    <span className="agent-card-name">{a.agent}</span>
                    <span className={`state-badge state-badge-${a.state}`}>{a.stateLabel}</span>
                  </div>
                  <div className="agent-card-row agent-card-meta">
                    <span>{duration}</span>
                    <span>{a.idleCode}</span>
                    <span>Handled {a.handled}</span>
                    <span>RONA {a.rona}</span>
                  </div>
                  {totalIdle && (
                    <div className="agent-card-row agent-card-meta">
                      <span>Total idle: {totalIdle}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="hint">No agents currently active.</p>
        )}
        <StateDonut stateCounts={stateCounts} />
      </div>
    </div>
  );
}
