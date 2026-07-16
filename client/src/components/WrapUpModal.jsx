import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

const WRAP_UP_CODES = ['Resolved', 'Follow-up needed', 'Transferred', 'No resolution'];

export function WrapUpModal({ task }) {
  const { setSession } = useSession();
  const [code, setCode] = useState(WRAP_UP_CODES[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await api(`/api/agent/tasks/${task.id}/wrapup`, { method: 'POST', body: JSON.stringify({ code }) });
    setSession((s) => ({ ...s, currentTask: null }));
    setBusy(false);
  };

  return (
    <div className="overlay">
      <div className="card wrapup">
        <h2>Wrap-up</h2>
        <p>Select a disposition code before closing this task.</p>
        <div className="wrapup-codes">
          {WRAP_UP_CODES.map((c) => (
            <button key={c} className={`pill ${code === c ? 'active' : ''}`} onClick={() => setCode(c)}>
              {c}
            </button>
          ))}
        </div>
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit & close'}
        </button>
      </div>
    </div>
  );
}
