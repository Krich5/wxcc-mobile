import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const FALLBACK_CODES = ['Resolved', 'Follow-up needed', 'Transferred', 'No resolution'].map((name) => ({
  id: name,
  name,
  defaultCode: false,
}));

export function WrapUpModal({ task, onDone, reloadSelf, resetSelfDuration, onPresenceChanged }) {
  const { session, setSession, setNotice } = useSession();
  const [codes, setCodes] = useState(session.mode === 'live' ? null : FALLBACK_CODES);
  const [codeId, setCodeId] = useState(session.mode === 'live' ? '' : FALLBACK_CODES[0].id);
  const [autoWrapAfterMs, setAutoWrapAfterMs] = useState(0);
  const [autoRemainingMs, setAutoRemainingMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submittedRef = useRef(false);
  // Guards the auto-wrap-up timer so it's armed exactly once per modal instance -- if
  // codes/autoWrapAfterMs were ever re-set (e.g. a re-fetch), we don't want to
  // accidentally restart or shorten an already-running countdown.
  const autoWrapArmedRef = useRef(false);

  useEffect(() => {
    if (session.mode !== 'live') return;
    api('/api/agent/wrapup-codes')
      .then(({ codes: list, autoWrapAfterMs: autoMs }) => {
        const options = list.length ? list : FALLBACK_CODES;
        setCodes(options);
        const defaultCode = options.find((c) => c.defaultCode);
        setCodeId(defaultCode?.id || options[0]?.id || '');
        setAutoWrapAfterMs(autoMs || 0);
      })
      .catch(() => {
        setCodes(FALLBACK_CODES);
        setCodeId(FALLBACK_CODES[0].id);
      });
  }, [session.mode]);

  const submit = async (overrideCodeId, overrideReason) => {
    const id = overrideCodeId || codeId;
    if (!id || submittedRef.current) return;
    const reason = overrideReason || codes?.find((c) => c.id === id)?.name || id;
    submittedRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/api/agent/tasks/${task.id}/wrapup`, {
        method: 'POST',
        body: JSON.stringify({ auxCodeId: id, wrapUpReason: reason }),
      });
      if (result.presenceError) {
        setNotice(`Wrap-up submitted, but couldn't set you back to Available: ${result.presenceError}`);
      }
      // WxCC's own agent-profile config decides the REAL post-wrap-up state (usually
      // Available, but could be an idle code) -- assume Available as an immediate
      // best-guess, then reset the ticker and ask the server shortly after so the
      // reconciliation effect in PresenceBar corrects this if the guess was wrong,
      // instead of leaving a stale/incorrect state up to a full poll cycle.
      setSession((s) => ({ ...s, currentTask: null, agentState: 'Available' }));
      resetSelfDuration?.();
      setTimeout(() => {
        reloadSelf?.();
        onPresenceChanged?.();
      }, 3000);
      onDone?.();
    } catch (err) {
      submittedRef.current = false;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Auto wrap-up: agent-profile.autoWrapAfterSeconds (already in ms despite the name) --
  // if configured, submit the default wrap-up code automatically once that much time has
  // passed rather than waiting indefinitely for the agent to pick one. Armed exactly
  // once (autoWrapArmedRef) so this can't be restarted/shortened by a later re-render.
  useEffect(() => {
    if (autoWrapArmedRef.current) return;
    if (!autoWrapAfterMs || !codes) return;
    const defaultCode = codes.find((c) => c.defaultCode);
    if (!defaultCode) return;
    autoWrapArmedRef.current = true;
    const startedAt = Date.now();
    // eslint-disable-next-line no-console
    console.log(`[wrapup] auto-wrap-up armed for ${autoWrapAfterMs}ms, default code "${defaultCode.name}"`);
    setAutoRemainingMs(autoWrapAfterMs);
    const tick = setInterval(() => {
      setAutoRemainingMs(Math.max(0, autoWrapAfterMs - (Date.now() - startedAt)));
    }, 1000);
    const timeout = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log(`[wrapup] auto-wrap-up firing after ${Date.now() - startedAt}ms (armed for ${autoWrapAfterMs}ms)`);
      submit(defaultCode.id, defaultCode.name);
    }, autoWrapAfterMs);
    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWrapAfterMs, codes]);

  return (
    <div className="overlay">
      <div className="card wrapup">
        <h2>Wrap-up</h2>
        <p>Select a disposition code before closing this task.</p>
        {!codes ? (
          <p className="hint">Loading wrap-up codes…</p>
        ) : (
          <div className="wrapup-codes">
            {codes.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pill ${codeId === c.id ? 'active' : ''}`}
                onClick={() => setCodeId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <button className="primary" onClick={() => submit()} disabled={busy || !codeId}>
          {busy ? 'Submitting…' : 'Submit & close'}
        </button>
        {autoWrapAfterMs > 0 && !busy && (
          <p className="hint">Auto wrap-up in {Math.ceil(autoRemainingMs / 1000)}s</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
