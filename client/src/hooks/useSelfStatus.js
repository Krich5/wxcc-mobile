import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Wall-clock time of the last local resetDuration() call, i.e. the moment we know a
  // state transition actually happened from the user's perspective.
  const resetAtMsRef = useRef(null);

  const reload = useCallback(() => {
    if (mode !== 'live') return;
    api('/api/agent/dashboard')
      .then(({ self: result }) => {
        if (!result) return;
        const resetAtMs = resetAtMsRef.current;
        if (resetAtMs != null) {
          // WxCC's own backend can lag before it reflects a state change we just made --
          // a poll landing in that gap still reports durationSec counted from the
          // PREVIOUS state (sometimes tens of seconds), which would otherwise make the
          // elapsed timer jump forward and keep ticking up from that inflated baseline.
          // Never let the accepted duration exceed how long we know it's actually been
          // since the transition; this self-corrects once WxCC's own value catches up.
          const elapsedSinceReset = (Date.now() - resetAtMs) / 1000;
          result = { ...result, durationSec: Math.min(result.durationSec, elapsedSinceReset) };
        }
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
    resetAtMsRef.current = Date.now();
    setFetchedAtMs(Date.now());
    setSelf((s) => ({ ...(s || {}), durationSec: 0 }));
  }, []);

  return { self, fetchedAtMs, reload, resetDuration };
}
