import { useState } from 'react';
import { api } from '../lib/api.js';

export function OutdialModal({ onClose, onActionTaken }) {
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/agent/outdial', { method: 'POST', body: JSON.stringify({ destination }) });
      // ActiveCall's own poll picks this up on its next 2s tick regardless, but firing an
      // immediate refresh right after the call is placed avoids that visible delay --
      // same "fetch data right when you click" pattern the other call controls use.
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
            placeholder="3866314619"
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
