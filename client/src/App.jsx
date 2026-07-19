import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { useSession } from './context/SessionContext.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { PresenceBar } from './components/PresenceBar.jsx';
import { IncomingTaskModal } from './components/IncomingTaskModal.jsx';
import { CallScreen } from './components/CallScreen.jsx';
import { WrapUpModal } from './components/WrapUpModal.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { ActiveCall } from './components/ActiveCall.jsx';
import { Spinner } from './components/Spinner.jsx';
import { enableNotifications, hasExistingSubscription } from './lib/push.js';
import { useActiveCall } from './hooks/useActiveCall.js';
import { useSelfStatus } from './hooks/useSelfStatus.js';

export default function App() {
  const { session, loading, notice, setNotice } = useSession();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const {
    call,
    endedTaskId,
    clearEnded,
    markEnded,
    refresh: refreshActiveCall,
    setOptimisticCall,
  } = useActiveCall(session.mode);
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

  // Recovers from a page reload that happens mid wrap-up: session.currentTask (what
  // WrapUpModal normally keys off of) is client-only state that resets on reload, so a
  // real wrap-up in progress -- confirmed independently via the header's own state
  // reconciliation -- would otherwise have no taskId left to submit against, leaving
  // the agent stuck showing "Wrap-up" with no way to actually clear it. Both the
  // automatic retry below and a manual click on the header pill (PresenceBar) call this
  // same recovery.
  // Tracks the taskId of whatever wrap-up was just submitted -- WxCC's own agentSession
  // state takes a few seconds to actually flip away from "wrapUp" after the agent
  // submits, so without this the recovery effect below sees that still-lagging state,
  // thinks the agent is stuck again on the SAME call, and pops the modal right back up
  // right after it was just closed.
  const lastWrappedTaskIdRef = useRef(null);

  const recoverWrapUp = async () => {
    try {
      const { taskId } = await api('/api/agent/wrapup-task');
      if (taskId && taskId !== lastWrappedTaskIdRef.current) {
        markEnded(taskId);
        return true;
      }
      if (!taskId) setNotice("Couldn't find your in-progress call to wrap up");
      return false;
    } catch (err) {
      setNotice(err.message);
      return false;
    }
  };

  const attemptedWrapupRecoveryRef = useRef(false);
  useEffect(() => {
    if (self?.state !== 'wrapUp') {
      attemptedWrapupRecoveryRef.current = false;
      return;
    }
    if (session.currentTask || endedTaskId || attemptedWrapupRecoveryRef.current) return;
    attemptedWrapupRecoveryRef.current = true;
    recoverWrapUp();
  }, [self?.state, session.currentTask, endedTaskId]);

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
        call={call}
        self={self}
        fetchedAtMs={fetchedAtMs}
        reloadSelf={reloadSelf}
        resetSelfDuration={resetSelfDuration}
        refreshActiveCall={refreshActiveCall}
        setOptimisticCall={setOptimisticCall}
        onRelaunchWrapUp={recoverWrapUp}
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
        {!task && <Dashboard data={dashboard} error={dashboardError} fetchedAtMs={fetchedAtMs} />}
        {task?.status === 'connected' && <CallScreen task={task} />}
        {task?.status === 'wrapup' && (
          <WrapUpModal
            task={task}
            onDone={() => {
              lastWrappedTaskIdRef.current = task.id;
            }}
            reloadSelf={reloadSelf}
            resetSelfDuration={resetSelfDuration}
          />
        )}
      </main>
      {task?.status === 'offered' && <IncomingTaskModal task={task} />}
      {/* Detected via active-call polling (the call we were tracking is no longer
          active) rather than the websocket task flow above, which never fires. */}
      {endedTaskId && task?.status !== 'wrapup' && (
        <WrapUpModal
          task={{ id: endedTaskId }}
          onDone={() => {
            lastWrappedTaskIdRef.current = endedTaskId;
            clearEnded();
          }}
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
