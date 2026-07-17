import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const POLL_MS = 2000;

// Single poll of /api/agent/active-call shared by the ActiveCall display and the
// wrap-up flow -- the websocket notification path never fires (subscribe never
// returns a websocketUrl), so "the call we were tracking is no longer in the active
// list" is our only signal that a call ended and wrap-up is needed.
export function useActiveCall(mode) {
  const [call, setCall] = useState(null);
  const [endedTaskId, setEndedTaskId] = useState(null);
  const lastCallIdRef = useRef(null);

  useEffect(() => {
    if (mode !== 'live') return;
    let cancelled = false;
    const load = () => {
      api('/api/agent/active-call')
        .then(({ call: result }) => {
          if (cancelled) return;
          if (!result && lastCallIdRef.current) {
            setEndedTaskId(lastCallIdRef.current);
          }
          lastCallIdRef.current = result?.id || null;
          setCall(result);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode]);

  return { call, endedTaskId, clearEnded: () => setEndedTaskId(null) };
}
