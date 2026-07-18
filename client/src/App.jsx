import { useEffect, useState } from 'react';
import { useSession } from './context/SessionContext.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { PresenceBar } from './components/PresenceBar.jsx';
import { IncomingTaskModal } from './components/IncomingTaskModal.jsx';
import { CallScreen } from './components/CallScreen.jsx';
import { WrapUpModal } from './components/WrapUpModal.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { ActiveCall } from './components/ActiveCall.jsx';
import { CallLog } from './components/CallLog.jsx';
import { Spinner } from './components/Spinner.jsx';
import { enableNotifications, hasExistingSubscription } from './lib/push.js';
import { useActiveCall } from './hooks/useActiveCall.js';
import { useSelfStatus } from './hooks/useSelfStatus.js';

export default function App() {
  const { session, loading, notice, setNotice } = useSession();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [callLogOpen, setCallLogOpen] = useState(false);
  const { call, endedTaskId, clearEnded, markEnded, refresh: refreshActiveCall } = useActiveCall(session.mode);
  const {
    self,
    dashboard,
    dashboardError,
    fetchedAtMs,
    reload: reloadSelf,
    resetDuration: resetSelfDuration,
  } = useSelfStatus(session.mode);

  useEffect(() => {
    hasExistingSubscription()
      .then(setNotificationsEnabled)
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="screen center">
        <Spinner />
        <p>Loading…</p>
      </div>
    );
  }
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
      <PresenceBar
        onOpenCallLog={() => setCallLogOpen(true)}
        self={self}
        fetchedAtMs={fetchedAtMs}
        reloadSelf={reloadSelf}
        resetSelfDuration={resetSelfDuration}
        refreshActiveCall={refreshActiveCall}
        notificationsEnabled={notificationsEnabled}
        onRequestNotifications={requestNotifications}
      />
      <main className="console">
        <ActiveCall
          call={call}
          onEnded={markEnded}
          onActionTaken={refreshActiveCall}
          self={self}
          fetchedAtMs={fetchedAtMs}
        />
        {!task && callLogOpen && <CallLog onClose={() => setCallLogOpen(false)} />}
        {!task && !callLogOpen && <Dashboard data={dashboard} error={dashboardError} fetchedAtMs={fetchedAtMs} />}
        {task?.status === 'connected' && <CallScreen task={task} />}
        {task?.status === 'wrapup' && (
          <WrapUpModal task={task} reloadSelf={reloadSelf} resetSelfDuration={resetSelfDuration} />
        )}
      </main>
      {task?.status === 'offered' && <IncomingTaskModal task={task} />}
      {/* Detected via active-call polling (the call we were tracking is no longer
          active) rather than the websocket task flow above, which never fires. */}
      {endedTaskId && task?.status !== 'wrapup' && (
        <WrapUpModal
          task={{ id: endedTaskId }}
          onDone={clearEnded}
          reloadSelf={reloadSelf}
          resetSelfDuration={resetSelfDuration}
        />
      )}
      {notice && (
        <div className="toast" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  );
}
