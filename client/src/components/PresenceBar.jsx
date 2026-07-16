import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

export function PresenceBar() {
  const { session, setSession, setNotice } = useSession();
  const [idleCodes, setIdleCodes] = useState([]);

  useEffect(() => {
    if (session.mode !== 'live') return;
    api('/api/agent/idle-codes')
      .then(({ codes }) => setIdleCodes(codes))
      .catch((err) => setNotice(`Couldn't load idle codes: ${err.message}`));
  }, [session.mode]);

  const setAvailable = async () => {
    try {
      await api('/api/agent/state', { method: 'POST', body: JSON.stringify({ state: 'Available' }) });
      setSession((s) => ({ ...s, agentState: 'Available' }));
    } catch (err) {
      setNotice(err.message);
    }
  };

  const setIdle = async (e) => {
    const code = idleCodes.find((c) => c.id === e.target.value);
    if (!code) return;
    try {
      await api('/api/agent/state', {
        method: 'POST',
        body: JSON.stringify({ state: 'Idle', auxCodeId: code.id, reason: code.name }),
      });
      setSession((s) => ({ ...s, agentState: `Idle: ${code.name}` }));
    } catch (err) {
      setNotice(err.message);
    }
  };

  const logout = async () => {
    await api('/api/agent/logout', { method: 'POST' });
    window.location.reload();
  };

  const isIdle = session.agentState?.startsWith('Idle');

  return (
    <header className="presence-bar">
      <div className="agent-name">{session.profile?.name || session.profile?.id || 'Agent'}</div>
      <div className="state-pills">
        <button className={`pill ${session.agentState === 'Available' ? 'active' : ''}`} onClick={setAvailable}>
          Available
        </button>
        {idleCodes.length > 0 ? (
          <select className={`pill-select ${isIdle ? 'active' : ''}`} value="" onChange={setIdle}>
            <option value="" disabled>
              {isIdle ? session.agentState.replace('Idle: ', '') : 'Idle…'}
            </option>
            {idleCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <button className={`pill ${isIdle ? 'active' : ''}`} disabled title="No idle codes loaded">
            Idle
          </button>
        )}
      </div>
      <button className="link" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}
