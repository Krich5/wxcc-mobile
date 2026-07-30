// Webex Contact Center reuses standard Webex Integration OAuth (idbroker-backed) with
// the added "cjp:user" scope for Contact Center access. Register an Integration at
// https://developer.webex-cx.com to get a client id/secret.
import express from 'express';
import { persistTokens } from '../session.js';
import { decodeSparkId } from '../wxcc/liveProvider.js';

const router = express.Router();

const AUTHORIZE_URL = 'https://webexapis.com/v1/authorize';
const TOKEN_URL = 'https://webexapis.com/v1/access_token';

// Documented Webex Integration behavior: DELETE https://webexapis.com/v1/access_token
// (Bearer = the token itself) permanently revokes it at Webex -- without this, "sign
// out" only forgot the token locally in our own cookie/session; the token itself
// remained valid indefinitely and Webex's own SSO session was untouched.
export async function revokeWebexTokens(session) {
  if (!session.tokens?.access_token) return;
  try {
    await fetch(TOKEN_URL, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.tokens.access_token}` },
    });
  } catch {
    // Non-fatal -- sign-out should still clear our own session/cookie either way.
  }
}

router.get('/login', (req, res) => {
  if (!process.env.WEBEX_CLIENT_ID) {
    return res.status(400).send('WEBEX_CLIENT_ID is not configured on the server');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WEBEX_CLIENT_ID,
    redirect_uri: process.env.WEBEX_REDIRECT_URI,
    // cjp:user is the WxCC agent-runtime scope; cjp:config_read is required separately
    // for org config lookups like List Teams. spark:people_read was just added to this
    // Integration specifically so resolveAgentContext() can call the generic Webex
    // people/me endpoint to identify the signed-in agent without asking for their email.
    // All three scopes must be enabled on the Integration at developer.webex-cx.com or
    // Webex will reject the authorize request with invalid_scope.
    scope: 'cjp:user cjp:config_read spark:people_read',
    state: req.session.id,
  });
  res.redirect(`${AUTHORIZE_URL}?${params}`);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code');
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.WEBEX_CLIENT_ID,
      client_secret: process.env.WEBEX_CLIENT_SECRET,
      code,
      redirect_uri: process.env.WEBEX_REDIRECT_URI,
    });
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => '');
      throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
    }
    const tokens = await tokenRes.json();

    // Org allowlist -- ALLOWED_ORG_IDS is a comma-separated list of WxCC org ids this
    // deployment is permitted for; unset/empty means no restriction (back-compat with
    // any existing deployment that hasn't configured it). Checked here, before this
    // token is ever stored in the session or used for any WxCC call, so a blocked org
    // never gets far enough to see a working app -- just an immediately-revoked token.
    const allowedOrgIds = (process.env.ALLOWED_ORG_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (allowedOrgIds.length) {
      const meRes = await fetch('https://webexapis.com/v1/people/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const me = meRes.ok ? await meRes.json().catch(() => null) : null;
      const orgId = me?.orgId ? decodeSparkId(me.orgId) : null;
      if (!orgId || !allowedOrgIds.includes(orgId)) {
        await fetch(TOKEN_URL, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }).catch(() => {});
        return res.redirect('/?blocked=1');
      }
    }

    req.session.tokens = tokens;
    req.session.tokensIssuedAt = Date.now();
    req.session.mode = 'live';
    persistTokens(res, tokens);
    res.redirect('/?connected=1');
  } catch (err) {
    res.status(500).send(`OAuth callback failed: ${err.message}`);
  }
});

router.get('/status', (req, res) => {
  res.json({ connected: Boolean(req.session.tokens), mode: req.session.mode });
});

router.get('/token', (req, res) => {
  // Debug-only: exposes this session's own access token so it can be tested directly
  // in Postman/curl. Deliberately omits the refresh_token (longer-lived, more
  // sensitive) -- only the short-lived access_token is returned.
  if (!req.session.tokens?.access_token) {
    return res.status(400).json({ ok: false, error: 'Not connected -- use /api/auth/login first' });
  }
  const { access_token, token_type, expires_in } = req.session.tokens;
  res.json({ ok: true, access_token, token_type, expires_in });
});

export default router;
