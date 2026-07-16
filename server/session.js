import crypto from 'crypto';
import { EventEmitter } from 'events';

const sessions = new Map();
const TOKEN_COOKIE = 'wxcc_tokens';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before actual expiry
const TOKEN_TOKEN_URL = 'https://webexapis.com/v1/access_token';

function createSession(id) {
  return {
    id,
    mode: null, // 'mock' | 'live'
    profile: null,
    tokens: null,
    tokensIssuedAt: 0,
    agentState: 'Offline',
    currentTask: null,
    pushSubscriptions: [],
    emitter: new EventEmitter(),
    liveSocket: null,
  };
}

export function persistTokens(res, tokens) {
  // Sessions themselves live only in server memory (a plain Map) -- any restart
  // (every redeploy, or Railway recycling the container) wipes them instantly. This
  // cookie is what survives that: on the next request, sessionMiddleware rehydrates a
  // fresh in-memory session from it instead of silently leaving the agent "logged in"
  // client-side but signed out server-side.
  res.cookie(TOKEN_COOKIE, JSON.stringify(tokens), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // bounded by how long Webex's refresh_token itself lasts
  });
}

export function clearTokenCookie(res) {
  res.clearCookie(TOKEN_COOKIE);
}

async function refreshAccessToken(session) {
  if (!session.tokens?.refresh_token) throw new Error('No refresh token available');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.WEBEX_CLIENT_ID,
    client_secret: process.env.WEBEX_CLIENT_SECRET,
    refresh_token: session.tokens.refresh_token,
  });
  const res = await fetch(TOKEN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  const tokens = await res.json();
  session.tokens = tokens;
  session.tokensIssuedAt = Date.now();
  return tokens;
}

export async function sessionMiddleware(req, res, next) {
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

  if (!req.session.tokens && req.cookies?.[TOKEN_COOKIE]) {
    try {
      const tokens = JSON.parse(req.cookies[TOKEN_COOKIE]);
      if (tokens?.access_token) {
        req.session.tokens = tokens;
        req.session.mode = 'live';
        // Unknown issue time for a rehydrated token -- treat it as due for a refresh
        // check immediately rather than assuming it's still fresh.
        req.session.tokensIssuedAt = 0;
      }
    } catch {
      // corrupt/stale cookie -- ignore, the agent will just need to reconnect
    }
  }

  if (req.session.tokens?.refresh_token) {
    const expiresInMs = (req.session.tokens.expires_in || 0) * 1000;
    const dueForRefresh = Date.now() - req.session.tokensIssuedAt > expiresInMs - REFRESH_BUFFER_MS;
    if (dueForRefresh) {
      try {
        const refreshed = await refreshAccessToken(req.session);
        persistTokens(res, refreshed);
      } catch {
        // Couldn't refresh -- leave the existing token in place. If it's truly expired,
        // the next WxCC API call will surface a clear 401/403 instead of failing silently.
      }
    }
  }

  next();
}
