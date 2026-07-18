import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState({
    mode: null,
    profile: null,
    agentState: 'Offline',
    currentTask: null,
  });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const missedLoginChecksRef = useRef(0);

  const refresh = useCallback(async () => {
    const data = await api('/api/agent/me');
    setSession(data);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    // The server session can diverge from what this tab last saw (a redeploy/restart
    // wiped it, it expired, etc.) without any user action -- re-sync on a timer and
    // whenever the app comes back to the foreground, so the UI never keeps showing a
    // signed-in state the server no longer agrees with.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => refresh().catch(() => {}), 60000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    // /api/agent/me above is pure in-memory session state -- it can never detect a
    // desktop-side logout, since a remote sign-out doesn't touch this server process's
    // session store at all. This periodically asks WxCC itself (the same query the
    // "already logged in" fast path uses at startup) whether the agent is STILL
    // actually logged in, and forces the app back to the login screen if not. Requires
    // 2 consecutive misses before acting -- a single miss can just be WxCC's own search
    // index momentarily behind, the same kind of transient inconsistency already seen
    // elsewhere in this app (see the dashboard state-mapping fix).
    const checkStillLoggedIn = async () => {
      if (!sessionRef.current.profile) return;
      try {
        const { alreadyLoggedIn } = await api('/api/agent/existing-session');
        if (alreadyLoggedIn) {
          missedLoginChecksRef.current = 0;
          return;
        }
        missedLoginChecksRef.current += 1;
        if (missedLoginChecksRef.current >= 2) {
          missedLoginChecksRef.current = 0;
          setSession((s) => ({ ...s, profile: null, agentState: 'Offline', currentTask: null }));
          setNotice("You've been signed out of WxCC (likely from another device). Please sign back in.");
        }
      } catch {
        // transient network/API error -- don't count against the debounce
      }
    };
    const interval = setInterval(checkStillLoggedIn, 45000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/agent/events');
    const onTaskUpdate = (evt) => setSession((s) => ({ ...s, currentTask: JSON.parse(evt.data) }));
    const onWrapupComplete = () => setSession((s) => ({ ...s, currentTask: null }));
    es.addEventListener('task:offered', onTaskUpdate);
    es.addEventListener('task:connected', onTaskUpdate);
    es.addEventListener('task:ended', onTaskUpdate);
    es.addEventListener('task:wrapup-complete', onWrapupComplete);
    return () => es.close();
  }, []);

  return (
    <SessionContext.Provider value={{ session, setSession, refresh, loading, notice, setNotice }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
