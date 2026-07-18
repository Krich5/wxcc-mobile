import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

// Reuses the same team + dial-number form as the initial sign-in
// (LoginScreen.jsx's LiveAgentLoginForm) and the same POST /api/agent/login endpoint --
// re-submitting it with new values is a real re-login, exactly like the initial one,
// which is what "edit the number you signed in with and resign in" actually means.
export function ProfileSettingsModal({ onClose }) {
  const { session, refresh, setNotice } = useSession();
  const [teams, setTeams] = useState(null);
  const [teamsError, setTeamsError] = useState(null);
  const [teamId, setTeamId] = useState(session.profile?.teamId || '');
  const [dialNumber, setDialNumber] = useState(session.profile?.dialNumber || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/agent/teams')
      .then(({ teams: list }) => {
        setTeams(list);
        // Pre-select whichever team matches the agent's CURRENT team, only falling back
        // to the first option if that current team isn't in the returned list.
        const current = list.find((t) => t.id === session.profile?.teamId);
        setTeamId(current?.id || list[0]?.id || session.profile?.teamId || '');
      })
      .catch((err) => {
        setTeamsError(err.message);
        setTeams([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const teamName = teams?.find((t) => t.id === teamId)?.name || teamId;
      const result = await api('/api/agent/login', {
        method: 'POST',
        body: JSON.stringify({ mode: 'live', teamId, teamName, dialNumber }),
      });
      if (result.notificationsError) {
        setNotice(`Updated, but real-time task alerts aren't working yet: ${result.notificationsError}`);
      }
      if (result.presenceError) {
        setNotice(`Updated, but couldn't set your default status: ${result.presenceError}`);
      }
      await refresh();
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
        <h2>Profile Settings</h2>
        <label className="field">
          Team
          {teams === null ? (
            <input value="Loading your teams…" disabled />
          ) : teams.length > 0 ? (
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="Team ID" required />
          )}
        </label>
        {teamsError && <p className="hint">Couldn't load your teams from WxCC ({teamsError}) — enter a Team ID manually.</p>}

        <label className="field">
          Dial number
          <input value={dialNumber} onChange={(e) => setDialNumber(e.target.value)} required />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="profile-settings-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save & Re-login'}
          </button>
        </div>
      </form>
    </div>
  );
}
