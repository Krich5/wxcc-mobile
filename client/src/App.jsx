import { useEffect, useState } from 'react';
import { useSession } from './context/SessionContext.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { PresenceBar } from './components/PresenceBar.jsx';
import { IncomingTaskModal } from './components/IncomingTaskModal.jsx';
import { CallScreen } from './components/CallScreen.jsx';
import { WrapUpModal } from './components/WrapUpModal.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { ActiveCall } from './components/ActiveCall.jsx';
import { enableNotifications, hasExistingSubscription } from './lib/push.js';
import { useActiveCall } from './hooks/useActiveCall.js';

export default function App() {
  const { session, loading, notice, setNotice } = useSession();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const { call, endedTaskId, clearEnded } = useActiveCall(session.mode);

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
        <ActiveCall call={call} />
        {!task && (
          <>
            <Dashboard />
            <div className="idle-panel">
              {!notificationsEnabled && (
                <button className="secondary" onClick={requestNotifications}>
                  Enable notifications
                </button>
              )}
            </div>
          </>
        )}
        {task?.status === 'connected' && <CallScreen task={task} />}
        {task?.status === 'wrapup' && <WrapUpModal task={task} />}
      </main>
      {task?.status === 'offered' && <IncomingTaskModal task={task} />}
      {/* Detected via active-call polling (the call we were tracking is no longer
          active) rather than the websocket task flow above, which never fires. */}
      {endedTaskId && task?.status !== 'wrapup' && (
        <WrapUpModal task={{ id: endedTaskId }} onDone={clearEnded} />
      )}
      {notice && (
        <div className="toast" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  );
}
