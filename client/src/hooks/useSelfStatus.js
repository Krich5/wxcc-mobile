import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const POLL_MS = 15000;

// The ONE poll of /api/agent/dashboard for the whole app. Previously the header state
// pill (via this hook) and the Dashboard roster each ran their own independent
// setInterval against the same endpoint -- since they never landed at the same instant,
// the two could show visibly different numbers for the same agent (e.g. a header
// duration a few seconds ahead of the roster's own row) even though both were "correct"
// for the moment they were fetched. Every consumer now reads from this single result
// object instead, so they literally cannot disagree.
export function useSelfStatus(mode) {
  const [dashboard, setDashboard] = useState(null); // { metrics, agents, stateCounts, self }
  const [dashboardError, setDashboardError] = useState(null);
  const [fetchedAtMs, setFetchedAtMs] = useState(null);
  // Wall-clock time of the last local resetDuration() call, i.e. the moment we know a
  // state transition actually happened from the user's perspective.
  const resetAtMsRef = useRef(null);

  const reload = useCallback(() => {
    if (mode !== 'live') return;
    api('/api/agent/dashboard')
      .then((result) => {
        let self = result?.self;
        const resetAtMs = resetAtMsRef.current;
        if (self && resetAtMs != null) {
          // WxCC's own backend can lag before it reflects a state change we just made --
          // a poll landing in that gap still reports durationSec counted from the
          // PREVIOUS state (sometimes tens of seconds), which would otherwise make the
          // elapsed timer jump forward and keep ticking up from that inflated baseline.
          // Never let the accepted duration exceed how long we know it's actually been
          // since the transition; this self-corrects once WxCC's own value catches up.
          const elapsedSinceReset = (Date.now() - resetAtMs) / 1000;
          self = { ...self, durationSec: Math.min(self.durationSec, elapsedSinceReset) };
        }
        setDashboard({ ...result, self });
        setDashboardError(null);
        setFetchedAtMs(Date.now());
      })
      .catch((err) => setDashboardError(err.message));
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
    setDashboard((d) => (d?.self ? { ...d, self: { ...d.self, durationSec: 0 } } : d));
  }, []);

  return { self: dashboard?.self || null, dashboard, dashboardError, fetchedAtMs, reload, resetDuration };
}
