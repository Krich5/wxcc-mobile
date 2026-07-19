import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export function OutdialModal({ onClose, onActionTaken, onCallStarted, headerHeight = 0, anis = null }) {
  const [destination, setDestination] = useState('');
  // Prefetched by PresenceBar at sign-in (rather than fetched here on open) -- most
  // profiles have zero or one caller-ID option configured (outdialANIId absent), in which
  // case the picker is hidden entirely and WxCC resolves the caller ID server-side, same
  // as before this existed.
  const [ani, setAni] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const defaultEntry = (anis || []).find((a) => a.isDefault);
    if (defaultEntry) setAni(defaultEntry.number);
  }, [anis]);

  const submit = async (e) => {
    e.preventDefault();
    if (!destination) return;
    setBusy(true);
    setError(null);
    try {
      const { task } = await api('/api/agent/outdial', {
        method: 'POST',
        body: JSON.stringify({ destination, ani: ani || undefined }),
      });
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
    <div className="overlay outdial-overlay" style={{ top: headerHeight }} onClick={onClose}>
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
        {anis && anis.length > 0 && (
          <label className="field">
            Outdial ANI
            <select value={ani} onChange={(e) => setAni(e.target.value)} required>
              <option value="" disabled>
                Enter Outdial ANI
              </option>
              {anis.map((a) => (
                <option key={a.id} value={a.number}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
