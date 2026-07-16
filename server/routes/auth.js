// Webex Contact Center reuses standard Webex Integration OAuth (idbroker-backed) with
// the added "cjp:user" scope for Contact Center access. Register an Integration at
// https://developer.webex-cx.com to get a client id/secret.
import express from 'express';

const router = express.Router();

const AUTHORIZE_URL = 'https://webexapis.com/v1/authorize';
const TOKEN_URL = 'https://webexapis.com/v1/access_token';

router.get('/login', (req, res) => {
  if (!process.env.WEBEX_CLIENT_ID) {
    return res.status(400).send('WEBEX_CLIENT_ID is not configured on the server');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WEBEX_CLIENT_ID,
    redirect_uri: process.env.WEBEX_REDIRECT_URI,
    // cjp:user is the WxCC agent-runtime scope; cjp:config_read is required separately
    // for org config lookups like List Teams. This Integration has no spark:* scopes at
    // all, so we don't request one -- listTeams() takes the org ID from config (WXCC_ORG_ID)
    // instead of resolving it via the generic Webex people/me endpoint. Both scopes below
    // must be enabled on the Integration at developer.webex-cx.com or Webex will reject the
    // authorize request with invalid_scope.
    scope: 'cjp:user cjp:config_read',
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
    req.session.tokens = await tokenRes.json();
    req.session.mode = 'live';
    res.redirect('/?connected=1');
  } catch (err) {
    res.status(500).send(`OAuth callback failed: ${err.message}`);
  }
});

router.get('/status', (req, res) => {
  res.json({ connected: Boolean(req.session.tokens), mode: req.session.mode });
});

export default router;
