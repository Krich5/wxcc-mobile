import { useState } from 'react';
import { useSession } from './context/SessionContext.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { PresenceBar } from './components/PresenceBar.jsx';
import { IncomingTaskModal } from './components/IncomingTaskModal.jsx';
import { CallScreen } from './components/CallScreen.jsx';
import { WrapUpModal } from './components/WrapUpModal.jsx';
import { api } from './lib/api.js';
import { enableNotifications } from './lib/push.js';

export default function App() {
  const { session, loading } = useSession();
  const [notice, setNotice] = useState(null);

  if (loading) return <div className="screen center">Loading…</div>;
  if (!session.profile) return <LoginScreen />;

  const task = session.currentTask;

  const simulateCall = async () => {
    try {
      await api('/api/agent/simulate-task', { method: 'POST' });
    } catch (err) {
      setNotice(err.message);
    }
  };

  const requestNotifications = async () => {
    try {
      await enableNotifications();
      setNotice('Push notifications enabled');
    } catch (err) {
      setNotice(err.message);
    }
  };

  return (
    <div className="app">
      <PresenceBar />
      <main className="console">
        {!task && (
          <div className="idle-panel">
            <p>Waiting for a task…</p>
            {session.mode === 'mock' && (
              <button className="primary" onClick={simulateCall}>
                Simulate incoming call
              </button>
            )}
            <button className="secondary" onClick={requestNotifications}>
              Enable notifications
            </button>
          </div>
        )}
        {task?.status === 'connected' && <CallScreen task={task} />}
        {task?.status === 'wrapup' && <WrapUpModal task={task} />}
      </main>
      {task?.status === 'offered' && <IncomingTaskModal task={task} />}
      {notice && (
        <div className="toast" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  );
}
