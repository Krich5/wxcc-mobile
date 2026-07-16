# WxCC Mobile Agent — POC

An installable PWA that proves the concept of a mobile Webex Contact Center agent client:
sign in, go Available/Idle, get alerted on an incoming task (even via a native push
notification), answer, run in-call controls, and wrap up.

## Two modes

- **Demo mode (mock)** — everything runs against an in-memory fake WxCC provider
  (`server/wxcc/mockProvider.js`). No Cisco credentials needed. Use the "Simulate incoming
  call" button to trigger the incoming-task flow.
- **Live mode** — routes through `server/wxcc/liveProvider.js`, which calls the real Webex
  Contact Center Agent REST APIs and subscribes to the WebSocket notification feed. This
  requires a Webex Contact Center Integration (Client ID/Secret, `cjp:user` scope) from
  https://developer.webex-cx.com. **The exact endpoint paths/payload field names in
  `liveProvider.js` are marked `TODO` and are best-effort from public docs/blog posts** —
  confirm them against your org's authenticated Postman collection before treating this as
  more than a POC.

## Project layout

```
client/   Vite + React PWA (installable manifest, service worker, UI)
server/   Express API: OAuth, session, mock/live WxCC providers, Web Push
```

## Local development

```bash
npm install                     # installs both workspaces
cp .env.example .env            # fill in values as needed (see below)
npm run dev:server              # terminal 1 — API on :8080
npm run dev:client              # terminal 2 — Vite dev server on :5173, proxies /api
```

Open http://localhost:5173, choose **Start Demo Mode**, then **Simulate incoming call** to
see the alert → answer → call screen → wrap-up flow.

### Enabling push notifications locally

1. `npx web-push generate-vapid-keys` and put the values in `.env` as `VAPID_PUBLIC_KEY` /
   `VAPID_PRIVATE_KEY`.
2. Restart the server, reload the client, tap **Enable notifications** and accept the
   browser prompt.
3. Tap **Simulate incoming call** with the tab backgrounded (or the PWA installed) to see a
   real OS-level push notification.

### Enabling live WxCC mode

1. Register an Integration at https://developer.webex-cx.com with scope `cjp:user`.
2. Set `WEBEX_CLIENT_ID`, `WEBEX_CLIENT_SECRET`, `WEBEX_REDIRECT_URI` in `.env`.
3. Set `WXCC_API_BASE_URL` to your org's regional base URL (e.g.
   `https://api.wxcc-us1.cisco.com`).
4. From the login screen, tap **Connect to Webex Contact Center**.
5. Before relying on this, open `server/wxcc/liveProvider.js` and verify every endpoint
   against your authenticated Postman collection — field names are best-effort.

## Installing as a PWA

- **Android/Chrome**: visit the deployed URL, use the "Install app" browser prompt or menu
  item.
- **iOS/Safari**: visit the deployed URL, tap Share → **Add to Home Screen**. iOS requires
  HTTPS and only supports Web Push for installed PWAs on iOS 16.4+.

## Deploying to Railway

This is a single Node service — the server serves the built client as static files.

1. Push this repo to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Railway auto-detects Node, runs `npm install`, then `npm run build` (builds the client),
   then `npm start` (starts the Express server, which serves `client/dist`).
4. Set the same environment variables from `.env.example` in the Railway project's
   Variables tab. Set `WEBEX_REDIRECT_URI` to `https://<your-railway-domain>/api/auth/callback`.

## What's stubbed vs. real

| Area | Status |
| --- | --- |
| PWA installability, manifest, service worker | Real, works today |
| Web Push alert for an incoming task | Real, works today (mock or live) |
| Demo mode (login, presence, task lifecycle, call controls, wrap-up) | Real, fully simulated |
| Live OAuth against Webex Identity | Real shape (standard Webex Integration OAuth + `cjp:user` scope) |
| Live agent login/logout/state/call-control REST calls | Best-effort skeleton — verify field names |
| Live WebSocket notification subscription/event mapping | Best-effort skeleton — verify event/type names |
| Actual call audio (WebRTC media) | Not implemented — out of scope for this POC |
