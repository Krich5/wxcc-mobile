import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';
import { APP_VERSION } from '../version.js';
import { formatElapsed } from '../lib/time.js';
import { applyTheme, getStoredTheme } from '../lib/theme.js';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 1020.354 15.354z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PresenceBar({
  onOpenCallLog,
  self,
  fetchedAtMs,
  reloadSelf,
  resetSelfDuration,
  notificationsEnabled,
  onRequestNotifications,
}) {
  const { session, setSession, setNotice } = useSession();
  const [idleCodes, setIdleCodes] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [, forceTick] = useState(0);
  const [branding, setBranding] = useState(null); // { appTitle, logo } from the team's desktop layout
  const [logoFailed, setLogoFailed] = useState(false);
  const [identity, setIdentity] = useState(null); // { displayName, avatar } from Webex's own /v1/people/me
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme);
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  const selectTheme = (next) => {
    if (next === theme) return;
    applyTheme(next);
    setTheme(next);
  };

  useEffect(() => {
    if (!headerRef.current) return;
    // Measured rather than a fixed pixel guess -- the header's real height depends on the
    // safe-area inset and content, so the menu (anchored to sit right below it, not
    // covering it) needs the actual rendered value, not an assumption.
    const update = () => setHeaderHeight(headerRef.current.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (session.mode !== 'live') return;
    // Purely cosmetic -- one fetch, no retry, and any failure is already reduced to
    // { appTitle: null, logo: null } server-side, so this never needs a notice/toast.
    api('/api/agent/desktop-branding')
      .then(({ appTitle, logo }) => setBranding({ appTitle, logo }))
      .catch(() => {});
  }, [session.mode]);

  useEffect(() => {
    if (session.mode !== 'live') return;
    api('/api/agent/identity')
      .then(({ displayName, avatar }) => setIdentity({ displayName, avatar }))
      .catch(() => {});
  }, [session.mode]);

  useEffect(() => {
    if (session.mode !== 'live') return;
    let cancelled = false;
    // Retries a few times before giving up: idle-codes depends on resolveAgentContext()'s
    // full people/me -> by-ci-user-id chain, which isn't restored from the session cookie
    // after a server restart -- the "already logged in" fast path skips the full re-login,
    // so this can be the first thing to actually re-resolve that chain, and a fetch landing
    // right at that cold-start moment can transiently fail before it settles.
    const load = (attempt = 0) => {
      api('/api/agent/idle-codes')
        .then(({ codes }) => {
          if (!cancelled) setIdleCodes(codes);
        })
        .catch((err) => {
          if (cancelled) return;
          if (attempt < 2) {
            setTimeout(() => load(attempt + 1), 2000);
          } else {
            setNotice(`Couldn't load idle codes: ${err.message}`);
          }
        });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [session.mode]);

  // Same source of truth as the dashboard's agent list -- reconcile our optimistic
  // client-side agentState with what WxCC actually reports every time the shared self
  // poll updates, so the two can never drift apart for long. Only Available/Idle are
  // reconciled here; on-call/ringing/wrap-up are transient call states that don't
  // correspond to a presence-dropdown option.
  useEffect(() => {
    if (!self) return;
    if (self.state === 'available') {
      setSession((s) => (s.agentState === 'Available' ? s : { ...s, agentState: 'Available' }));
    } else if (self.state === 'idle') {
      const label = self.idleCode && self.idleCode !== '—' ? self.idleCode : self.stateLabel;
      const next = `Idle: ${label}`;
      setSession((s) => (s.agentState === next ? s : { ...s, agentState: next }));
    }
    // Deliberately keyed on the state fields, not the `self` object reference: resetSelfDuration()
    // replaces `self` with a new object that only zeroes durationSec, which would otherwise re-run
    // this effect against the still-stale state and stomp the optimistic update in applyState().
  }, [self?.state, self?.idleCode, self?.stateLabel, setSession]);

  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const applyState = async (value) => {
    setStateMenuOpen(false);
    if (value.startsWith('current:')) return; // placeholder option, not a real choice
    if (value === 'Available') {
      try {
        await api('/api/agent/state', { method: 'POST', body: JSON.stringify({ state: 'Available' }) });
        setSession((s) => ({ ...s, agentState: 'Available' }));
        // Reset the ticker immediately -- don't reconcile against the real search-API
        // data right away, though: WxCC's own backend has a beat of lag before a state
        // change we JUST made shows up there, so reconciling synchronously here would
        // read back the still-stale PREVIOUS state and stomp this optimistic update. A
        // short delay avoids racing that lag while still confirming much sooner than the
        // full poll interval.
        resetSelfDuration?.();
        setTimeout(() => reloadSelf?.(), 3000);
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
      resetSelfDuration?.();
      setTimeout(() => reloadSelf?.(), 3000);
    } catch (err) {
      setNotice(err.message);
    }
  };

  const logout = async () => {
    try {
      await api('/api/agent/logout', { method: 'POST' });
    } catch {
      // Non-fatal -- always fall through to reload below. Previously an error here
      // (thrown by api() on a non-2xx response) would skip the reload entirely, leaving
      // the UI showing "logged in" even though the server-side WxCC logout had already
      // gone through -- sign-out must always land back on the login screen.
    }
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

  const elapsedSinceFetch = fetchedAtMs != null ? (Date.now() - fetchedAtMs) / 1000 : 0;
  const elapsed = self && fetchedAtMs != null ? formatElapsed(self.durationSec + elapsedSinceFetch) : null;
  // Time in the CURRENT reason (elapsed, resets on every idle-code switch) vs. total time
  // idle overall (self.totalIdleSec, cumulative until the agent goes Available/on-call) --
  // matches Cisco's own desktop header format ("Lunch - 00:00 / 02:24") and the same two
  // numbers already shown in the Agent State roster below.
  const totalIdleElapsed =
    self?.totalIdleSec != null && fetchedAtMs != null
      ? formatElapsed(self.totalIdleSec + elapsedSinceFetch)
      : null;
  // Only the closed button shows elapsed time -- the open list just shows plain state
  // names, since a live-ticking clock frozen inside a dropdown option reads as stale/odd.
  const currentLabel = isAvailable ? 'Available' : matchedCode?.name || currentIdleName || 'Idle';

  return (
    <>
      <header className="presence-bar" ref={headerRef}>
        <div className="presence-bar-team">
          <img
            className="presence-bar-logo"
            src={branding?.logo && !logoFailed ? branding.logo : '/icons/logo.png'}
            onError={() => setLogoFailed(true)}
            alt=""
          />
          <span>{branding?.appTitle || session.profile?.teamName || 'Agent'}</span>
        </div>
        <div className="presence-bar-actions">
          <div className="state-dropdown">
            <button
              type="button"
              className={`state-select ${isAvailable ? 'is-available' : 'is-idle'}`}
              onClick={() => setStateMenuOpen((o) => !o)}
            >
              <span>
                {currentLabel}
                {elapsed ? ` ${elapsed}` : ''}
                {totalIdleElapsed ? ` / ${totalIdleElapsed}` : ''}
              </span>
              <span className="state-select-caret">▾</span>
            </button>
            {stateMenuOpen && (
              <>
                <div className="state-dropdown-overlay" onClick={() => setStateMenuOpen(false)} />
                <ul className="state-dropdown-list">
                  <li
                    className={selectedValue === 'Available' ? 'active' : ''}
                    onClick={() => applyState('Available')}
                  >
                    Available
                  </li>
                  {currentIdleName && !matchedCode && <li className="active">{currentIdleName}</li>}
                  {idleCodes.map((c) => (
                    <li key={c.id} className={selectedValue === c.id ? 'active' : ''} onClick={() => applyState(c.id)}>
                      {c.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <button
            className={`hamburger ${menuOpen ? 'open' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Menu'}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="side-panel-overlay" style={{ top: headerHeight }} onClick={() => setMenuOpen(false)}>
          <div className="side-panel" onClick={(e) => e.stopPropagation()}>
            <div className="side-panel-signout-row">
              <button className="side-panel-signout" onClick={() => setConfirmSignOut(true)}>
                <SignOutIcon /> Sign Out
              </button>
            </div>
            <div className="side-panel-content">
              {identity?.displayName && (
                <div className="side-panel-identity">
                  {identity.avatar && !avatarFailed ? (
                    <img
                      className="side-panel-avatar"
                      src={identity.avatar}
                      onError={() => setAvatarFailed(true)}
                      alt=""
                    />
                  ) : (
                    <div className="side-panel-avatar side-panel-avatar-initials">
                      {getInitials(identity.displayName)}
                    </div>
                  )}
                  <p className="side-panel-name">{identity.displayName}</p>
                </div>
              )}
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
              {!notificationsEnabled && (
                <button
                  className="secondary"
                  onClick={() => {
                    setMenuOpen(false);
                    onRequestNotifications?.();
                  }}
                >
                  Enable notifications
                </button>
              )}
              <div className="side-panel-field">
                <span className="side-panel-label">Mode</span>
                <div className="theme-toggle-track">
                  <button
                    type="button"
                    className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => selectTheme('light')}
                  >
                    <SunIcon /> Light
                  </button>
                  <button
                    type="button"
                    className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => selectTheme('dark')}
                  >
                    <MoonIcon /> Dark
                  </button>
                </div>
              </div>
            </div>
            <p className="side-panel-version">App version {APP_VERSION}</p>
          </div>
        </div>
      )}

      {confirmSignOut && (
        <div className="overlay" onClick={() => setConfirmSignOut(false)}>
          <div className="card signout-confirm-card" onClick={(e) => e.stopPropagation()}>
            <h2>Sign Out Confirmation</h2>
            <p>Are you sure you want to sign out?</p>
            <div className="signout-confirm-actions">
              <button className="secondary" onClick={() => setConfirmSignOut(false)}>
                Cancel
              </button>
              <button className="signout-confirm-button" onClick={logout}>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
