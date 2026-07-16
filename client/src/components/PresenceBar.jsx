import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

export function PresenceBar() {
  const { session, setSession, setNotice } = useSession();
  const [idleCodes, setIdleCodes] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);

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
    <>
      <header className="presence-bar">
        <button className="hamburger" onClick={() => setMenuOpen(true)} aria-label="Menu">
          <span />
          <span />
          <span />
        </button>
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
      </header>

      {menuOpen && (
        <div className="side-panel-overlay" onClick={() => setMenuOpen(false)}>
          <div className="side-panel" onClick={(e) => e.stopPropagation()}>
            <button className="side-panel-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              &times;
            </button>
            <div className="side-panel-content">
              <div className="side-panel-field">
                <span className="side-panel-label">Team</span>
                <span className="side-panel-value">{session.profile?.teamName || '—'}</span>
              </div>
              <div className="side-panel-field">
                <span className="side-panel-label">Dial number</span>
                <span className="side-panel-value">{session.profile?.dialNumber || '—'}</span>
              </div>
            </div>
            <button className="secondary" onClick={logout}>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
