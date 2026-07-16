import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const POLL_MS = 15000;

const STAT_CARDS = [
  { key: 'waitingNow', label: 'Waiting Now' },
  { key: 'longestWait', label: 'Longest In Queue' },
  { key: 'totalHandled', label: 'Total Handled' },
  { key: 'connected', label: 'Connected' },
  { key: 'totalAbandoned', label: 'Total Abandoned' },
];

export function Dashboard() {
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
  }, [session.mode]);

  if (session.mode !== 'live') return null;
  if (error) return <p className="hint">Couldn't load the dashboard: {error}</p>;
  if (!data) return <p className="hint">Loading dashboard…</p>;

  const { metrics, queues, agents, stateCounts } = data;

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

      {queues.length > 0 && (
        <div className="dashboard-section">
          <p className="dashboard-section-title">Queue Details</p>
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Waiting</th>
                  <th>Avg Wait</th>
                  <th>Longest Wait</th>
                  <th>Handled</th>
                  <th>Abandoned</th>
                  <th>Connected</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.id}>
                    <td>{q.name}</td>
                    <td>{q.waiting}</td>
                    <td>{q.avgWait}</td>
                    <td>{q.longestWait}</td>
                    <td>{q.handled}</td>
                    <td>{q.abandoned}</td>
                    <td>{q.connected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <p className="dashboard-section-title">Agent State</p>
        <div className="state-pill-row">
          <span className="state-pill state-pill-available">{stateCounts.available} Available</span>
          <span className="state-pill state-pill-connected">{stateCounts.onCall} Connected</span>
          <span className="state-pill state-pill-wrapup">{stateCounts.wrapUp} Wrap-up</span>
          <span className="state-pill state-pill-idle">{stateCounts.idle + stateCounts.offline} Idle</span>
        </div>
        {agents.length > 0 ? (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Agent</th>
                  <th>State</th>
                  <th>Duration</th>
                  <th>Idle Code</th>
                  <th>Handled</th>
                  <th>RONA</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td>{a.team}</td>
                    <td>{a.agent}</td>
                    <td>
                      <span className={`state-badge state-badge-${a.state}`}>{a.stateLabel}</span>
                    </td>
                    <td>{a.duration}</td>
                    <td>{a.idleCode}</td>
                    <td>{a.handled}</td>
                    <td>{a.rona}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">No agents currently active.</p>
        )}
      </div>
    </div>
  );
}
