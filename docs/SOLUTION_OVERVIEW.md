# WxCC Mobile Agent — Solution Overview

**Status:** Proof of concept, actively developed and tested against a real Webex Contact Center org.
**Current deployment:** Railway (`https://wxcc-mobile-production.up.railway.app`)
**Source:** GitHub, private repo (`Krich5/wxcc-mobile`)

## 1. What This Is

A mobile-first Progressive Web App (PWA) that lets a Webex Contact Center (WxCC) agent do the core parts of their job from a phone, installed to the home screen like a native app:

- Sign in with their real Webex identity (OAuth) and log in to WxCC (team + dial number)
- Change presence/status (Available, or any configured Idle reason), with live elapsed-time tracking
- See a real-time dashboard scoped to exactly what their own agent profile is permitted to see (queues, teams, roster)
- See their own active call (caller ID, ringing/engaged/on-hold status, live duration) and control it: Hold/Unhold, Consult (to a number, an available-or-idle agent, or an address-book contact), Transfer (to a number or an available agent), Merge, End Consult, End
- Get prompted to wrap up after a call ends, with an auto-wrap-up timer if their profile has one configured
- Review a call log of recent calls
- Get push notifications for incoming work (where the platform supports it)

It does **not** replace the agent's phone for actually answering/dialing calls — the agent still uses their desk phone or softphone for that. This app is the presence, visibility, and call-control layer around it.

## 2. How It's Built

This is a two-part application, but it deploys and runs as a **single service**:

### Client — React + Vite PWA
- Plain React (no framework like Next.js), built with Vite
- A hand-written service worker (`client/public/sw.js`) provides the installable-app shell and push notification handling. Navigations and the manifest are served network-first (so the app can never get stuck showing a stale build); hashed static assets are cache-first.
- No client-side routing — it's a single view that switches between login/dashboard/call states based on session data from the server

### Server — Node.js + Express
- One Express process serves **both** the REST API (`/api/...`) and the built client's static files — there's no separate CDN or static host to manage
- Acts as the OAuth client and a secure proxy to Webex/WxCC's APIs: the browser never holds a Webex access token directly, only an `httpOnly` session cookie
- Talks to three different Cisco/Webex API surfaces:
  1. **Webex OAuth** (`webexapis.com`) — sign-in, and resolving the signed-in person's identity
  2. **WxCC REST APIs** (`api.wxcc-us1.cisco.com`) — agent login/logout, presence changes, call control (hold/consult/transfer/etc.), wrap-up, org config lookups (teams, queues, auxiliary codes, agent profile, address book)
  3. **WxCC's GraphQL search API** and a **notification WebSocket** — used for the real-time dashboard, the agent's own active-call status, and (as of the most recent work) an async "buddy list" of other agents to consult/transfer to

### Session handling
- Sessions live in server memory (a plain `Map`), keyed by an `httpOnly` `sid` cookie
- The actual Webex OAuth tokens are **also** persisted in a second `httpOnly` cookie, so that if the server process restarts (which happens on every Railway redeploy, and can happen at any time on a hosting platform that recycles containers), the next request re-hydrates a working session instead of silently logging the agent out
- If the in-memory session is gone but WxCC's own backend still shows the agent logged in, the app detects that and skips re-running the login step — so a mid-shift restart doesn't reset the agent's real status

This session design is intentionally simple for a POC. It has a real limitation worth flagging now: **it only works with a single running instance.** See §5.

## 3. How It Runs Today (Railway)

Railway is a "push your code, we build and run it" platform — it's why this POC could go from zero to a working, installable app quickly, without anyone standing up servers. Concretely, for this project, Railway provides:

- **Build pipeline:** on `railway up` (or a connected git push), Railway detects this is a Node project, runs `npm install` and `npm run build` (which builds the React client into `client/dist`), then runs `npm start` (which starts the Express server that serves both the API and that built client)
- **Hosting/runtime:** a container running the Node process, restarted automatically if it crashes
- **HTTPS + a public domain:** `wxcc-mobile-production.up.railway.app`, with TLS handled for us
- **Environment variables / secrets:** set in the Railway dashboard, injected into the process at runtime
- **Logs:** `railway logs` / the Railway dashboard — this has been essential for this POC, since several of Cisco's undocumented API behaviors (response shapes, async delivery over the notification socket) could only be confirmed by logging real traffic and reading it back
- **WebSocket support:** the notification channel to WxCC is a long-lived outbound WebSocket the server opens — Railway's networking doesn't need any special configuration for this since it's an outbound connection, but it's worth calling out explicitly for §5 below, since not every hosting setup makes that a given

None of this is unique to Railway — it's a fairly standard "managed Node hosting" feature set (comparable to Render, Fly.io, Heroku, etc.). The point of this section is to make explicit what would need a replacement if this moves to internal infrastructure.

## 4. Configuration This App Needs (Wherever It Runs)

These are environment variables the server reads at startup — none of this is Railway-specific:

| Variable | Purpose |
|---|---|
| `PORT` | Port the Express server listens on |
| `SESSION_SECRET` | Used for cookie signing |
| `WEBEX_CLIENT_ID` / `WEBEX_CLIENT_SECRET` | Credentials for the Webex OAuth Integration (registered at developer.webex-cx.com) |
| `WEBEX_REDIRECT_URI` | Must exactly match the domain this app is actually served from — **this is the one value that has to change if the domain changes** |
| `WXCC_API_BASE_URL` | Regional WxCC API base, e.g. `https://api.wxcc-us1.cisco.com` |
| `WXCC_ORG_ID` | Fallback org ID (the normal path resolves this dynamically per signed-in agent; this is only a fallback) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push keys for incoming-task notifications |

The Webex Integration itself (Client ID/Secret, redirect URI, scopes: `cjp:user cjp:config_read spark:people_read`) is registered once in developer.webex-cx.com and is independent of hosting — moving hosts does **not** require a new Integration, just updating its redirect URI.

## 5. What We'd Need to Build to Host This Ourselves

If we move this off Railway onto our own dev/production infrastructure, here's the actual checklist — none of it is exotic, but it's currently handled for free by Railway and needs an explicit owner otherwise:

1. **A place to run a long-lived Node.js 18+ process.** This is not something that works as static files on a plain web server (Apache/Nginx serving files only) — it needs an actual process running (`npm start`), because the API and the OAuth/session logic are server-side. Options: a VM/container we manage, an internal PaaS, or a container platform (ECS, Cloud Run, etc.) if we have one.
2. **A process manager / restart policy.** Something needs to restart the Node process if it crashes or the host reboots (pm2, systemd, a container orchestrator's own restart policy — any of these work).
3. **HTTPS with a real domain**, reverse-proxied to the Node process. Webex OAuth requires an HTTPS redirect URI; this also needs updating in the Webex Integration's settings.
4. **Outbound network access to Cisco's domains** (`webexapis.com`, `api.wxcc-us1.cisco.com`, and the WebSocket notification endpoint on the same host) — the app opens these connections *itself*, outbound; nothing needs to accept an incoming WebSocket connection from a browser. In practice this is rarely restricted, but worth a quick check if there's a strict outbound firewall in front of wherever this ends up running.
5. **Secrets management** for the six environment variables in §4 — however we already do this for other internal apps (a `.env` file with restricted permissions, a secrets manager, CI/CD secret injection, etc.)
6. **A build step**: `npm install && npm run build` before every deploy, since the client is a compiled React bundle, not something edited in place.
7. **A deploy mechanism**: something that pushes new code to that host and restarts the process — this is the main thing Railway currently automates end-to-end (`git push` → build → deploy). Internally this could be as simple as a deploy script over SSH, or a proper CI/CD pipeline (Bitbucket Pipelines, Jenkins, etc.) if we want parity with what we have now.
8. **Log access** for whoever supports this app — several real bugs in this POC were only diagnosable by reading raw API/WebSocket traffic from server logs, so this isn't optional tooling, it's been load-bearing for development.
9. **A decision on session storage if we ever run more than one instance.** Today, sessions live in that single process's memory. Running two instances behind a load balancer would randomly log agents out depending on which instance handled a given request, unless we introduce a shared session store (Redis is the standard choice) or sticky sessions at the load balancer. For a single-instance internal deployment, this isn't an immediate blocker — just something to plan for before scaling out.

## 6. Known Limitations (Honest POC Caveats)

Worth stating plainly for whoever's evaluating this for real use:

- **Single-instance only** right now (see §5.9)
- **Several WxCC API behaviors were undocumented and had to be discovered by testing** against a real org and reading raw responses/logs (e.g., the exact fields required for hold/consult/transfer, and how the "buddy list" of other agents is delivered asynchronously over the notification socket). This is normal for working against a platform this fresh, but it means some edge cases may still surface as this gets used more.
- **Consulting/transferring to a Queue or Entry Point isn't built yet** — only dial-number, address-book, and agent-to-agent are, pending confirmation of the right agent-profile fields for the other two.
- **Auto-wrap-up timing, idle codes, wrap-up codes, and viewable dashboard scope are all pulled live from each agent's real WxCC agent-profile** — this app doesn't hardcode any of that, so it should behave correctly for any agent/profile without code changes, but it also means it inherits whatever that profile is configured to do.

## 7. Recommendation

For continued piloting with a small group, Railway is a reasonable place to stay — it's low-effort and has been reliable. The trigger for moving to internal infrastructure would be a real decision to roll this out more broadly (data residency/compliance requirements, wanting it alongside other internally-hosted tools, or wanting our own on-call/monitoring in front of it rather than Railway's). If/when that's the decision, §5 above is the concrete build list — nothing in it is a redesign of the app itself, it's standard "productionize a Node app" work.

## 8. Concrete Steps for a Specific Target: `automation.cxsol.com` (Ubuntu + Apache)

We confirmed this server is a real Ubuntu box running Apache 2.4 — a completely standard setup for what §5 describes. (Note: `cxasteam.bitbucket.io` is a *different* thing — that's Bitbucket's own static-page hosting, run by Atlassian, and can never run this app; it's unrelated to this section.) Here's what actually setting this up on `automation.cxsol.com` looks like, mapped directly to the §5 checklist:

1. **Install Node.js 18+.** Ubuntu doesn't ship a recent-enough Node by default. The standard approach is NodeSource's setup script:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
2. **Get the code onto the server** — either `git clone` the Bitbucket repo directly onto the box, or extend whatever pull-on-webhook mechanism already deploys the other projects there (the same `webhook.php`-style pattern), so a push to Bitbucket triggers an update here too.
3. **Install and build:**
   ```bash
   npm install
   npm run build   # compiles the React client into client/dist
   ```
4. **Create a `.env` file** in the project root with the six variables from §4 — `WEBEX_REDIRECT_URI` needs to point at wherever this ends up living (e.g. `https://automation.cxsol.com/api/auth/callback`, or a dedicated subdomain if that's preferred).
5. **Run it as a persistent service with systemd** (so it survives crashes and reboots), rather than just running `npm start` in a terminal. Example unit file (`/etc/systemd/system/wxcc-mobile.service`):
   ```ini
   [Unit]
   Description=WxCC Mobile Agent
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/path/to/wxcc-mobile
   ExecStart=/usr/bin/npm start
   Restart=on-failure
   EnvironmentFile=/path/to/wxcc-mobile/.env

   [Install]
   WantedBy=multi-user.target
   ```
   Then: `sudo systemctl enable --now wxcc-mobile`.
6. **Configure Apache as a reverse proxy** in front of it, so the public domain forwards to the Node process's local port (default `8080`):
   ```apache
   ProxyPreserveHost On
   ProxyPass / http://127.0.0.1:8080/
   ProxyPassReverse / http://127.0.0.1:8080/
   ```
   (Requires `sudo a2enmod proxy proxy_http` once.) This can be its own subdomain's VirtualHost, or a sub-path of the existing `automation.cxsol.com` site if that's preferred — a dedicated subdomain is simpler and avoids any collision with what else is already served from that domain.
7. **HTTPS certificate** for whatever domain/subdomain this lands on — if the server already uses Let's Encrypt/certbot for its existing HTTPS (likely, given `automation.cxsol.com` is already serving over HTTPS), the same tool can issue one for a new subdomain in a couple of commands.
8. **Update the Webex Integration's redirect URI** at developer.webex-cx.com to match whatever URL this ends up at.
9. **Deploys going forward**: pull the latest code, re-run steps 3, then `sudo systemctl restart wxcc-mobile`. This is the one piece Railway currently does with zero effort (`railway up` = build + restart in one command); on this box it'd be a short script your admin runs (or wires into the existing webhook deploy mechanism) doing the same four steps.

None of this requires any new tooling or accounts — it's the same handful of well-known building blocks (`systemd`, Apache's `mod_proxy`, `certbot`) already likely in use for whatever else runs on that server.
