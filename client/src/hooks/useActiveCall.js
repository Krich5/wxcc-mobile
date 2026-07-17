import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Set by markEnded() right after an action (End/Transfer/consult-transfer) that we
  // KNOW removes the agent from the call -- WxCC's own backend can take a beat to
  // reflect that, so without this a poll landing in that gap would read the call as
  // still active and silently resurrect it, undoing the immediate transition to wrap-up.
  const suppressIdRef = useRef(null);
  const mountedRef = useRef(true);

  const load = useCallback(() => {
    if (mode !== 'live') return;
    api('/api/agent/active-call')
      .then(({ call: result }) => {
        if (!mountedRef.current) return;
        if (suppressIdRef.current && result?.id === suppressIdRef.current) return;
        suppressIdRef.current = null;
        if (!result && lastCallIdRef.current) {
          setEndedTaskId(lastCallIdRef.current);
        }
        lastCallIdRef.current = result?.id || null;
        setCall(result);
      })
      .catch(() => {});
  }, [mode]);

  useEffect(() => {
    mountedRef.current = true;
    if (mode !== 'live') return;
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [mode, load]);

  // Called right when an action confirms the call is over, instead of waiting up to
  // POLL_MS for the next poll to notice -- e.g. clicking Transfer/End shouldn't leave
  // the card reading "Engaged" for a couple more seconds after the API call already
  // succeeded.
  const markEnded = (taskId) => {
    suppressIdRef.current = taskId;
    lastCallIdRef.current = null;
    setCall(null);
    setEndedTaskId(taskId);
  };

  return { call, endedTaskId, clearEnded: () => setEndedTaskId(null), markEnded, refresh: load };
}
