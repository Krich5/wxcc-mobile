import { useState } from 'react';
import { api } from '../lib/api.js';

export function OutdialModal({ onClose, onActionTaken, onCallStarted }) {
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      const { task } = await api('/api/agent/outdial', { method: 'POST', body: JSON.stringify({ destination }) });
      // The real active-call poll can lag several seconds before this new task is
      // searchable -- show a "Calling…" card right away instead of the screen looking
      // like nothing happened while the callee's phone is still ringing.
      if (task?.id) {
        onCallStarted?.({
          id: task.id,
          status: 'dialing',
          statusLabel: 'Calling…',
          direction: 'outbound',
          origin: null,
          destination,
          createdTimeMs: Date.now(),
          team: null,
          entryPoint: null,
          customerName: null,
          customerPhone: destination,
        });
      }
      onActionTaken?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card profile-settings-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New Call</h2>
        <label className="field">
          Phone number
          <input
            type="tel"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="5551234567"
            autoFocus
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="profile-settings-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !destination}>
            {busy ? 'Calling…' : 'Call'}
          </button>
        </div>
      </form>
    </div>
  );
}
