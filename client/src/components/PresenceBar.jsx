import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

// Mobile screen only has room for a couple of quick states -- Lunch/Break cover the
// common cases. Matched by name against the agent's real idle codes so the actual
// auxCodeId/reason still goes to the real API.
const IDLE_PRESETS = ['lunch', 'break'];

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

  const setIdle = async (code) => {
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

  const presetButtons = IDLE_PRESETS.map((keyword) => ({
    keyword,
    code: idleCodes.find((c) => c.name.toLowerCase().includes(keyword)),
  }));

  return (
    <header className="presence-bar">
      <div className="agent-name">{session.profile?.name || session.profile?.id || 'Agent'}</div>
      <div className="state-pills">
        <button
          className={`pill pill-success ${session.agentState === 'Available' ? 'active' : ''}`}
          onClick={setAvailable}
        >
          Available
        </button>
        {presetButtons.map(({ keyword, code }) => (
          <button
            key={keyword}
            className={`pill pill-danger ${session.agentState === `Idle: ${code?.name}` ? 'active' : ''}`}
            onClick={() => code && setIdle(code)}
            disabled={!code}
            title={code ? undefined : `No "${keyword}" idle code found on your profile`}
          >
            {code ? code.name : keyword[0].toUpperCase() + keyword.slice(1)}
          </button>
        ))}
      </div>
      <button className="link" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}
