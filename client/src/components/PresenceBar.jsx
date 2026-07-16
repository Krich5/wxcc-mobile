import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const STATES = ['Available', 'Idle'];

export function PresenceBar() {
  const { session, setSession } = useSession();

  const setState = async (state) => {
    await api('/api/agent/state', { method: 'POST', body: JSON.stringify({ state }) });
    setSession((s) => ({ ...s, agentState: state }));
  };

  const logout = async () => {
    await api('/api/agent/logout', { method: 'POST' });
    window.location.reload();
  };

  return (
    <header className="presence-bar">
      <div className="agent-name">{session.profile?.name || session.profile?.id || 'Agent'}</div>
      <div className="state-pills">
        {STATES.map((s) => (
          <button
            key={s}
            className={`pill ${session.agentState === s ? 'active' : ''}`}
            onClick={() => setState(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <button className="link" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}
