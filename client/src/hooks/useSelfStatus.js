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
        let agents = result?.agents;
        const resetAtMs = resetAtMsRef.current;
        if (self && resetAtMs != null) {
          // WxCC's own backend can lag before it reflects a state change we just made --
          // a poll landing in that gap still reports durationSec counted from the
          // PREVIOUS state (sometimes tens of seconds), which would otherwise make the
          // elapsed timer jump forward and keep ticking up from that inflated baseline.
          // Never let the accepted duration exceed how long we know it's actually been
          // since the transition; this self-corrects once WxCC's own value catches up.
          // Applied to this agent's roster row too, not just self, so the two can't
          // show different numbers if a reload lands inside that same window.
          const elapsedSinceReset = (Date.now() - resetAtMs) / 1000;
          const clamped = Math.min(self.durationSec, elapsedSinceReset);
          self = { ...self, durationSec: clamped };
          if (Array.isArray(agents)) {
            agents = agents.map((a) => (a.id === self.id ? { ...a, durationSec: clamped } : a));
          }
        }
        setDashboard({ ...result, self, agents });
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

  // Optimistically zero the ticker (and, via `patch`, the state/stateLabel/idleCode
  // label) right after a local state change, without waiting for a fresh poll to confirm
  // it (the poll itself is deliberately delayed elsewhere to avoid racing WxCC's own
  // backend propagation lag). Also patches this agent's own row in `agents` (matched via
  // self.id) so the roster doesn't keep showing the stale pre-switch duration OR label
  // for those same few seconds while only the header updates -- previously only
  // durationSec was reset here, so e.g. switching Presenting -> Meeting showed the new
  // duration instantly but kept the OLD idle-code name/label until the delayed reload.
  const resetDuration = useCallback((patch) => {
    resetAtMsRef.current = Date.now();
    setFetchedAtMs(Date.now());
    setDashboard((d) => {
      if (!d?.self) return d;
      const nextSelf = { ...d.self, durationSec: 0, ...patch };
      const agents = Array.isArray(d.agents)
        ? d.agents.map((a) => (a.id === d.self.id ? { ...a, durationSec: 0, ...patch } : a))
        : d.agents;
      return { ...d, self: nextSelf, agents };
    });
  }, []);

  return { self: dashboard?.self || null, dashboard, dashboardError, fetchedAtMs, reload, resetDuration };
}
