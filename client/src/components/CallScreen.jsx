import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

export function CallScreen({ task }) {
  const { setSession } = useSession();
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const end = async () => {
    const { task: updated } = await api(`/api/agent/tasks/${task.id}/end`, { method: 'POST' });
    setSession((s) => ({ ...s, currentTask: updated }));
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="screen call-screen">
      <p className="queue">{task.queue}</p>
      <h2>{task.ani}</h2>
      <p className="timer">
        {mm}:{ss}
      </p>
      <div className="call-controls">
        <button className={`round ${muted ? 'active' : ''}`} onClick={() => setMuted((m) => !m)}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button className="round end" onClick={end}>
          End
        </button>
      </div>
    </div>
  );
}
