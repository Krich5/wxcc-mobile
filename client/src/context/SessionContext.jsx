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
