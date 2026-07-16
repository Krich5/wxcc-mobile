import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

export function LoginScreen() {
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
