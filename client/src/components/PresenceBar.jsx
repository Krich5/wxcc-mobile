import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const DASHBOARD_POLL_MS = 15000;

function formatElapsed(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function PresenceBar({ onOpenCallLog }) {
  const { session, setSession, setNotice } = useSession();
  const [idleCodes, setIdleCodes] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // The state-change reason (e.g. "Login") only tells us WHAT state we're in; the
  // duration comes from the same WxCC agentSession record the dashboard already reads
  // (real, server-tracked elapsed time -- not a client timer that resets on reload),
  // ticked locally between polls.
  const [selfBase, setSelfBase] = useState(null); // { baseSec, fetchedAtMs }
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (session.mode !== 'live') return;
    api('/api/agent/idle-codes')
      .then(({ codes }) => setIdleCodes(codes))
      .catch((err) => setNotice(`Couldn't load idle codes: ${err.message}`));
  }, [session.mode]);

  const loadSelf = useCallback(() => {
    if (session.mode !== 'live') return;
    api('/api/agent/dashboard')
      .then(({ self }) => {
        if (!self) return;
        setSelfBase({ baseSec: self.durationSec, fetchedAtMs: Date.now() });
        // Same source of truth as the dashboard's agent list -- reconcile our
        // optimistic client-side agentState with what WxCC actually reports every
        // poll, so the two can never drift apart for long. Only Available/Idle are
        // reconciled here; on-call/ringing/wrap-up are transient call states that
        // don't correspond to a presence-dropdown option.
        if (self.state === 'available') {
          setSession((s) => (s.agentState === 'Available' ? s : { ...s, agentState: 'Available' }));
        } else if (self.state === 'idle') {
          const label = self.idleCode && self.idleCode !== '—' ? self.idleCode : self.stateLabel;
          const next = `Idle: ${label}`;
          setSession((s) => (s.agentState === next ? s : { ...s, agentState: next }));
        }
      })
      .catch(() => {});
  }, [session.mode, setSession]);

  useEffect(() => {
    if (session.mode !== 'live') return;
    loadSelf();
    const interval = setInterval(loadSelf, DASHBOARD_POLL_MS);
    return () => clearInterval(interval);
  }, [session.mode, loadSelf]);

  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const applyState = async (value) => {
    if (value.startsWith('current:')) return; // placeholder option, not a real choice
    if (value === 'Available') {
      try {
        await api('/api/agent/state', { method: 'POST', body: JSON.stringify({ state: 'Available' }) });
        setSession((s) => ({ ...s, agentState: 'Available' }));
        // Reset the ticker immediately rather than waiting up to DASHBOARD_POLL_MS for
        // the next scheduled poll, then reconcile against the real search-API duration
        // right away too.
        setSelfBase({ baseSec: 0, fetchedAtMs: Date.now() });
        loadSelf();
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
      setSelfBase({ baseSec: 0, fetchedAtMs: Date.now() });
      loadSelf();
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

  const elapsed = selfBase
    ? formatElapsed(selfBase.baseSec + (Date.now() - selfBase.fetchedAtMs) / 1000)
    : null;
  const labelWithElapsed = (value, label) => (value === selectedValue && elapsed ? `${label} ${elapsed}` : label);

  return (
    <>
      <header className="presence-bar">
        <div className="presence-bar-team">{session.profile?.teamName || 'Agent'}</div>
        <div className="presence-bar-actions">
          <select
            className={`state-select ${isAvailable ? 'is-available' : 'is-idle'}`}
            value={selectedValue}
            onChange={(e) => applyState(e.target.value)}
          >
            <option value="Available">{labelWithElapsed('Available', 'Available')}</option>
            {currentIdleName && !matchedCode && (
              <option value={`current:${currentIdleName}`}>
                {labelWithElapsed(`current:${currentIdleName}`, currentIdleName)}
              </option>
            )}
            {idleCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {labelWithElapsed(c.id, c.name)}
              </option>
            ))}
          </select>
          <button className="hamburger" onClick={() => setMenuOpen(true)} aria-label="Menu">
            <span />
            <span />
            <span />
          </button>
        </div>
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
              <button
                className="secondary"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenCallLog?.();
                }}
              >
                Call Log
              </button>
            </div>
            <button className="secondary" onClick={() => setConfirmSignOut(true)}>
              Sign Out
            </button>
          </div>
        </div>
      )}

      {confirmSignOut && (
        <div className="overlay" onClick={() => setConfirmSignOut(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>Sign out?</h2>
            <p>You'll need to reconnect to Webex to sign back in.</p>
            <button className="primary" onClick={logout}>
              Sign Out
            </button>
            <button className="secondary" onClick={() => setConfirmSignOut(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
