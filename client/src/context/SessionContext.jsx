import { createContext, useContext, useEffect, useState, useCallback } from 'react';
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
