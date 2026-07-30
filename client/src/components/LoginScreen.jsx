import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';
import { Spinner } from './Spinner.jsx';

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
  const blocked = new URLSearchParams(window.location.search).get('blocked') === '1';

  const loginLive = () => {
    window.location.href = '/api/auth/login';
  };

  if (blocked) {
    return (
      <div className="screen login-screen">
        <img className="logo" src="/icons/logo.png" alt="" />
        <h1>Unauthorized</h1>
        <p className="subtitle">
          Your organization isn't authorized to use this app. Contact whoever shared this link with you.
        </p>
        <button className="secondary" onClick={loginLive}>
          Try a different account
        </button>
      </div>
    );
  }

  return (
    <div className="screen login-screen">
      <img className="logo" src="/icons/logo.png" alt="" />
      <h1>Webex Contact Center</h1>

      <button className="primary" onClick={loginLive}>
        Login
      </button>
    </div>
  );
}

function LiveAgentLoginForm() {
  const { refresh, setNotice } = useSession();
  // WxCC itself may already consider this agent logged in (e.g. our own server
  // restarted and lost session.profile, but the real agent session never ended) --
  // check before showing the team/dial-number picker again, so a reload doesn't
  // re-run /v2/agents/login and reset whatever real state the agent was actually in.
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [teams, setTeams] = useState(null); // null = loading, [] = failed/empty (fall back to free text)
  const [teamsError, setTeamsError] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [dialNumber, setDialNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/agent/existing-session')
      .then(({ alreadyLoggedIn }) => {
        if (alreadyLoggedIn) return refresh();
        setCheckingExisting(false);
      })
      .catch(() => setCheckingExisting(false));
  }, []);

  useEffect(() => {
    if (checkingExisting) return;
    api('/api/agent/teams')
      .then(({ teams: list, defaultDialNumber }) => {
        setTeams(list);
        if (list[0]) setTeamId(list[0].id);
        if (defaultDialNumber) setDialNumber(defaultDialNumber);
      })
      .catch((err) => {
        setTeamsError(err.message);
        setTeams([]);
      });
  }, [checkingExisting]);

  if (checkingExisting) {
    return (
      <div className="screen center">
        <Spinner />
        <p>Loading…</p>
      </div>
    );
  }

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
        setNotice(
          `Signed in, but real-time task alerts aren't working yet: ${result.notificationsError}`
        );
      }
      if (result.presenceError) {
        setNotice(`Signed in, but couldn't set your default status: ${result.presenceError}`);
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api('/api/agent/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };

  return (
    <form className="screen login-screen" onSubmit={submit}>
      <h1>Set your interaction preferences</h1>

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
        {busy ? 'Signing in…' : 'Login'}
      </button>
      {error && (
        <p className="error">
          {error} &mdash; this is likely one of the endpoints marked TODO in{' '}
          <code>server/wxcc/liveProvider.js</code>; verify it against your org's Postman collection.
        </p>
      )}

      <button className="secondary" type="button" onClick={signOut}>
        Sign out
      </button>
    </form>
  );
}
