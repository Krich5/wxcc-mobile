import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const FALLBACK_CODES = ['Resolved', 'Follow-up needed', 'Transferred', 'No resolution'].map((name) => ({
  id: name,
  name,
}));

export function WrapUpModal({ task }) {
  const { session, setSession } = useSession();
  const [codes, setCodes] = useState(session.mode === 'live' ? null : FALLBACK_CODES);
  const [codeId, setCodeId] = useState(session.mode === 'live' ? '' : FALLBACK_CODES[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (session.mode !== 'live') return;
    api('/api/agent/wrapup-codes')
      .then(({ codes: list }) => {
        const options = list.length ? list : FALLBACK_CODES;
        setCodes(options);
        setCodeId(options[0]?.id || '');
      })
      .catch(() => {
        setCodes(FALLBACK_CODES);
        setCodeId(FALLBACK_CODES[0].id);
      });
  }, [session.mode]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/agent/tasks/${task.id}/wrapup`, {
        method: 'POST',
        body: JSON.stringify({ code: codeId }),
      });
      setSession((s) => ({ ...s, currentTask: null }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

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
        <button className="primary" onClick={submit} disabled={busy || !codeId}>
          {busy ? 'Submitting…' : 'Submit & close'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
