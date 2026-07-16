import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

export function LoginScreen() {
  const { session, refresh } = useSession();

  // OAuth already completed (session.mode === 'live') but the actual WxCC agent
  // login -- which needs a team + dial number -- hasn't happened yet. Without this
  // step the app looks like it's "looping" back to the login screen after Webex sign-in.
  if (session.mode === 'live') {
    return <LiveAgentLoginForm />;
  }

  return <ModeChoice />;
}

function ModeChoice() {
  const { refresh } = useSession();
  const [name, setName] = useState('Demo Agent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loginMock = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/agent/login', { method: 'POST', body: JSON.stringify({ mode: 'mock', name }) });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loginLive = () => {
    window.location.href = '/api/auth/login';
  };

  return (
    <div className="screen login-screen">
      <h1>WxCC Mobile Agent</h1>
      <p className="subtitle">Proof of concept &mdash; install this app to your home screen</p>

      <label className="field">
        Display name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="primary" onClick={loginMock} disabled={busy}>
        {busy ? 'Signing in…' : 'Start Demo Mode'}
      </button>

      <div className="divider">or</div>

      <button className="secondary" onClick={loginLive}>
        Connect to Webex Contact Center
      </button>
      <p className="hint">
        Live mode requires a Webex Contact Center Integration (Client ID/Secret) configured on the
        server &mdash; see the README.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function LiveAgentLoginForm() {
  const { refresh } = useSession();
  const [teams, setTeams] = useState(null); // null = loading, [] = failed/empty (fall back to free text)
  const [teamsError, setTeamsError] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [dialNumber, setDialNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/agent/teams')
      .then(({ teams: list }) => {
        setTeams(list);
        if (list[0]) setTeamId(list[0].id);
      })
      .catch((err) => {
        setTeamsError(err.message);
        setTeams([]);
      });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/agent/login', {
        method: 'POST',
        body: JSON.stringify({ mode: 'live', teamId, dialNumber }),
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    await api('/api/agent/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };

  return (
    <form className="screen login-screen" onSubmit={submit}>
      <h1>Connected to Webex</h1>
      <p className="subtitle">
        Choose your team and enter a dial number to complete agent login against the real WxCC API.
      </p>

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
          <input
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="Team ID"
            required
          />
        )}
      </label>
      {teamsError && (
        <p className="hint">
          Couldn't load your teams from WxCC ({teamsError}) &mdash; enter a Team ID manually, or check{' '}
          <code>listTeams()</code> in <code>server/wxcc/liveProvider.js</code>.
        </p>
      )}

      <label className="field">
        Dial number
        <input value={dialNumber} onChange={(e) => setDialNumber(e.target.value)} required />
      </label>

      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in as agent'}
      </button>
      {error && (
        <p className="error">
          {error} &mdash; this is likely one of the endpoints marked TODO in{' '}
          <code>server/wxcc/liveProvider.js</code>; verify it against your org's Postman collection.
        </p>
      )}

      <button className="secondary" type="button" onClick={startOver}>
        Start over
      </button>
    </form>
  );
}
