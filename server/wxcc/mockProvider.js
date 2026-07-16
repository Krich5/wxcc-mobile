import crypto from 'crypto';

const QUEUES = ['Support Queue', 'Billing Queue', 'Sales Queue'];
const ANIS = ['+1 555 0142', '+1 555 0198', '+1 555 0177'];

export function login(session, { name }) {
  session.profile = { id: 'mock-agent-1', name: name || 'Demo Agent' };
  session.agentState = 'Available';
  return { profile: session.profile, agentState: session.agentState };
}

export function logout(session) {
  session.agentState = 'Offline';
  session.profile = null;
  session.currentTask = null;
}

export function setState(session, state) {
  session.agentState = state;
  return { agentState: state };
}

export function simulateIncomingTask(session) {
  if (session.currentTask) {
    throw new Error('A task is already in progress');
  }
  const task = {
    id: crypto.randomUUID(),
    channel: 'telephony',
    ani: ANIS[Math.floor(Math.random() * ANIS.length)],
    queue: QUEUES[Math.floor(Math.random() * QUEUES.length)],
    status: 'offered',
    offeredAt: Date.now(),
  };
  session.currentTask = task;
  session.emitter.emit('task:offered', task);
  return task;
}

export function answerTask(session, taskId) {
  const task = session.currentTask;
  if (!task || task.id !== taskId) throw new Error('No matching task');
  task.status = 'connected';
  session.emitter.emit('task:connected', task);
  return task;
}

export function endTask(session, taskId) {
  const task = session.currentTask;
  if (!task || task.id !== taskId) throw new Error('No matching task');
  task.status = 'wrapup';
  session.emitter.emit('task:ended', task);
  return task;
}

export function wrapupTask(session, taskId, code) {
  session.currentTask = null;
  const result = { taskId, code };
  session.emitter.emit('task:wrapup-complete', result);
  return result;
}
