import { useEffect, useState } from 'react';
import { useSession } from './context/SessionContext.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { PresenceBar } from './components/PresenceBar.jsx';
import { IncomingTaskModal } from './components/IncomingTaskModal.jsx';
import { CallScreen } from './components/CallScreen.jsx';
import { WrapUpModal } from './components/WrapUpModal.jsx';
import { enableNotifications, hasExistingSubscription } from './lib/push.js';

export default function App() {
  const { session, loading, notice, setNotice } = useSession();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    hasExistingSubscription()
      .then(setNotificationsEnabled)
      .catch(() => {});
  }, []);

  if (loading) return <div className="screen center">Loading…</div>;
  if (!session.profile) return <LoginScreen />;

  const task = session.currentTask;

  const requestNotifications = async () => {
    try {
      await enableNotifications();
      setNotificationsEnabled(true);
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
            {!notificationsEnabled && (
              <button className="secondary" onClick={requestNotifications}>
                Enable notifications
              </button>
            )}
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
