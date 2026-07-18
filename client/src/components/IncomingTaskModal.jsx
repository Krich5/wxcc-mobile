import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

export function IncomingTaskModal({ task }) {
  const { setSession } = useSession();

  const answer = async () => {
    const { task: updated } = await api(`/api/agent/tasks/${task.id}/answer`, { method: 'POST' });
    setSession((s) => ({ ...s, currentTask: updated }));
  };

  const decline = async () => {
    await api(`/api/agent/tasks/${task.id}/end`, { method: 'POST' });
    setSession((s) => ({ ...s, currentTask: null }));
  };

  return (
    <div className="overlay">
      <div className="card incoming-call">
        <div className="pulse-ring" />
        <h2>Incoming Call</h2>
        <p className="ani">{task.ani}</p>
        <p className="queue">{task.queue}</p>
        <div className="call-actions">
          <button className="decline" onClick={decline}>
            Decline
          </button>
          <button className="answer" onClick={answer}>
            Answer
          </button>
        </div>
      </div>
    </div>
  );
}
