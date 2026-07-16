import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../context/SessionContext.jsx';

export function QueueList() {
  const { session } = useSession();
  const [queues, setQueues] = useState(null);

  useEffect(() => {
    if (session.mode !== 'live') return;
    api('/api/agent/queues')
      .then(({ queues: list }) => setQueues(list))
      .catch(() => setQueues([]));
  }, [session.mode]);

  if (session.mode !== 'live' || !queues?.length) return null;

  return (
    <div className="queue-list">
      <p className="queue-list-title">Your queues</p>
      <ul>
        {queues.map((q) => (
          <li key={q.id}>{q.name}</li>
        ))}
      </ul>
    </div>
  );
}
