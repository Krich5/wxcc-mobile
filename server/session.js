import crypto from 'crypto';
import { EventEmitter } from 'events';

const sessions = new Map();

function createSession(id) {
  return {
    id,
    mode: null, // 'mock' | 'live'
    profile: null,
    tokens: null,
    agentState: 'Offline',
    currentTask: null,
    pushSubscriptions: [],
    emitter: new EventEmitter(),
    liveSocket: null,
  };
}

export function sessionMiddleware(req, res, next) {
  let sid = req.cookies?.sid;
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomUUID();
    sessions.set(sid, createSession(sid));
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    });
  }
  req.session = sessions.get(sid);
  next();
}
