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

  const applyState = async (value) => {
    if (value === 'Available') {
      try {
        await api('/api/agent/state', { method: 'POST', body: JSON.stringify({ state: 'Available' }) });
        setSession((s) => ({ ...s, agentState: 'Available' }));
      } catch (err) {
        setNotice(err.message);
      }
      return;
    }
    const code = idleCodes.find((c) => c.id === value);
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

  const isAvailable = session.agentState === 'Available';
  const selectedValue = isAvailable
    ? 'Available'
    : idleCodes.find((c) => session.agentState === `Idle: ${c.name}`)?.id || '';

  return (
    <header className="presence-bar">
      <div className="agent-name">{session.profile?.name || session.profile?.id || 'Agent'}</div>
      <select
        className={`state-select ${isAvailable ? 'is-available' : 'is-idle'}`}
        value={selectedValue}
        onChange={(e) => applyState(e.target.value)}
      >
        <option value="Available">Available</option>
        {idleCodes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button className="link" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}
