import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const POLL_MS = 15000;

// Single shared poll of /api/agent/dashboard's `self` field -- the same WxCC
// agentSession record the roster's own per-agent duration comes from. Both the header
// state pill and the active-call timer consume this one source so they can't show two
// different numbers for "how long have I been in this state" (durationSec resets on
// every state transition, including going on/off hold).
export function useSelfStatus(mode) {
  const [self, setSelf] = useState(null); // { state, stateLabel, durationSec, idleCode }
  const [fetchedAtMs, setFetchedAtMs] = useState(null);

  const reload = useCallback(() => {
    if (mode !== 'live') return;
    api('/api/agent/dashboard')
      .then(({ self: result }) => {
        if (!result) return;
        setSelf(result);
        setFetchedAtMs(Date.now());
      })
      .catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (mode !== 'live') return;
    reload();
    const interval = setInterval(reload, POLL_MS);
    return () => clearInterval(interval);
  }, [mode, reload]);

  // Optimistically zero the ticker right after a local state change, without waiting for
  // a fresh poll to confirm it (the poll itself is deliberately delayed elsewhere to
  // avoid racing WxCC's own backend propagation lag).
  const resetDuration = useCallback(() => {
    setFetchedAtMs(Date.now());
    setSelf((s) => ({ ...(s || {}), durationSec: 0 }));
  }, []);

  return { self, fetchedAtMs, reload, resetDuration };
}
