import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const FALLBACK_CODES = ['Resolved', 'Follow-up needed', 'Transferred', 'No resolution'].map((name) => ({
  id: name,
  name,
  defaultCode: false,
}));

export function WrapUpModal({ task, onDone }) {
  const { session, setSession } = useSession();
  const [codes, setCodes] = useState(session.mode === 'live' ? null : FALLBACK_CODES);
  const [codeId, setCodeId] = useState(session.mode === 'live' ? '' : FALLBACK_CODES[0].id);
  const [autoWrapAfterMs, setAutoWrapAfterMs] = useState(0);
  const [autoRemainingMs, setAutoRemainingMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submittedRef = useRef(false);

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
      await api(`/api/agent/tasks/${task.id}/wrapup`, {
        method: 'POST',
        body: JSON.stringify({ auxCodeId: id, wrapUpReason: reason }),
      });
      setSession((s) => ({ ...s, currentTask: null }));
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
  // passed rather than waiting indefinitely for the agent to pick one.
  useEffect(() => {
    if (!autoWrapAfterMs || !codes) return;
    const defaultCode = codes.find((c) => c.defaultCode);
    if (!defaultCode) return;
    const startedAt = Date.now();
    setAutoRemainingMs(autoWrapAfterMs);
    const tick = setInterval(() => {
      setAutoRemainingMs(Math.max(0, autoWrapAfterMs - (Date.now() - startedAt)));
    }, 1000);
    const timeout = setTimeout(() => submit(defaultCode.id, defaultCode.name), autoWrapAfterMs);
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
