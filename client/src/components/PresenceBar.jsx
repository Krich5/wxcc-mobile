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
    if (value.startsWith('current:')) return; // placeholder option, not a real choice
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
  // Before idleCodes finishes loading (or if the name genuinely doesn't match any known
  // code), there's no <option> matching the real state -- <select> would silently fall
  // back to showing the FIRST option's text ("Available") while still applying the
  // correct is-idle styling, which reads as a bug (red pill labeled "Available"). A
  // synthetic placeholder option keeps the displayed text honest either way.
  const currentIdleName =
    !isAvailable && session.agentState?.startsWith('Idle: ') ? session.agentState.slice('Idle: '.length) : null;
  const matchedCode = currentIdleName ? idleCodes.find((c) => c.name === currentIdleName) : null;
  const selectedValue = isAvailable
    ? 'Available'
    : matchedCode?.id || (currentIdleName ? `current:${currentIdleName}` : '');

  return (
    <header className="presence-bar">
      <div className="agent-name">
        <strong>Team:</strong> {session.profile?.teamName || session.profile?.name || 'Agent'}
      </div>
      <select
        className={`state-select ${isAvailable ? 'is-available' : 'is-idle'}`}
        value={selectedValue}
        onChange={(e) => applyState(e.target.value)}
      >
        <option value="Available">Available</option>
        {currentIdleName && !matchedCode && (
          <option value={`current:${currentIdleName}`}>{currentIdleName}</option>
        )}
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
