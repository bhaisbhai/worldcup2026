# Game Buddy — Full Implementation Reference

This document captures every architectural decision, bug, fix, and gotcha from the World Cup 2026 build. Written as a reference for rebuilding this for the Premier League. Do not delete or compress — this is the memory of the project.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [File Structure](#file-structure)
4. [Data Flow](#data-flow)
5. [ESPN API](#espn-api)
6. [AI Pipeline](#ai-pipeline)
7. [Push Notifications](#push-notifications)
8. [Frontend](#frontend)
9. [API Endpoints (Vercel Serverless)](#api-endpoints-vercel-serverless)
10. [GitHub Actions Workflows](#github-actions-workflows)
11. [Environment Variables](#environment-variables)
12. [Timezone Bugs — Critical Section](#timezone-bugs--critical-section)
13. [Full Bug History](#full-bug-history)
14. [Premier League Rebuild Notes](#premier-league-rebuild-notes)

---

## Architecture Overview

A single-page app (one giant `index.html`) served statically from Vercel. Live match data comes from the ESPN public API proxied through Vercel serverless functions. AI-generated content (match recaps, pre-match stakes) is generated nightly by a GitHub Actions pipeline using Gemini, committed to the repo as JSON files, and served as static data. Push notifications use native Web Push API with Upstash Redis storing subscriptions.

```
User Browser
    │
    ├─ Fetches index.html (static, Vercel CDN)
    ├─ Fetches /data/recaps.json (static, Vercel CDN)
    ├─ Fetches /data/stakes.json (static, Vercel CDN)
    └─ Fetches /api/scoreboard → Vercel function → ESPN API (live)

GitHub Actions (nightly, 4–8am UTC)
    ├─ Calls ESPN API for yesterday's scores
    ├─ Calls Gemini AI for recap text
    ├─ Calls ESPN API for tomorrow's schedule + standings
    ├─ Calls Gemini AI for stakes text
    └─ Commits data/recaps.json + data/stakes.json to main

GitHub Actions (8am UTC daily)
    └─ Sends morning digest push notification via Upstash Redis → all subscribers
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Vercel |
| Frontend | Single HTML file (vanilla JS, Tailwind CSS via CDN) |
| Build | Vite (only for TypeScript scripts, not the frontend itself) |
| Live data | ESPN public API (no auth required) |
| AI | Google Gemini 2.5 Flash (`gemini-2.5-flash`) via `@google/genai` |
| AI pipeline runtime | GitHub Actions + `tsx` to run TypeScript scripts |
| Push notifications | Native Web Push API (VAPID) |
| Subscription storage | Upstash Redis (HTTP REST API, `@upstash/redis`) |
| Notification sending | `web-push` npm package |
| Serverless functions | Vercel Node.js (`@vercel/node`) |

---

## File Structure

```
/
├── index.html              ← Entire frontend app (~270KB, single file)
├── sw.js                   ← Service worker (push notifications only)
├── vercel.json             ← Vercel build + routing config
├── package.json
├── data/
│   ├── recaps.json         ← AI-generated match recaps (committed by pipeline)
│   └── stakes.json         ← AI-generated pre-match stakes (committed by pipeline)
├── api/
│   ├── package.json        ← CRITICAL: {"type":"commonjs"} — all api/*.js must use CommonJS
│   ├── _proxy.js           ← Reusable ESPN proxy with cache headers
│   ├── subscribe.js        ← Web push subscription storage (POST/DELETE)
│   ├── recaps.js           ← Serves data/recaps.json
│   ├── scoreboard.js       ← Proxies ESPN scoreboard
│   ├── standings.js        ← Proxies ESPN standings
│   └── [others]            ← Other ESPN proxies
├── scripts/
│   ├── generate-ai-content.ts    ← Main nightly pipeline
│   ├── send-notifications.ts     ← Push notification sender
│   └── [other scripts]
└── .github/workflows/
    ├── overnight-ai-sync.yml     ← Nightly recap + stakes generation
    └── morning-digest.yml        ← Daily 8am fixture notification
```

---

## Data Flow

### Live match data
1. Frontend calls `/api/scoreboard?dates=YYYYMMDD`
2. Vercel function (`api/scoreboard.js`) proxies to `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard`
3. Response cached with `Cache-Control: no-store, s-maxage=10, stale-while-revalidate=10`
   - `no-store` prevents Safari PWA from aggressively caching live data
   - `s-maxage=10` allows Vercel's edge CDN to cache for 10 seconds

### AI-generated content (recaps + stakes)
1. GitHub Actions runs `scripts/generate-ai-content.ts` nightly
2. Script fetches ESPN for yesterday's games and tomorrow's schedule
3. Calls Gemini AI (two separate focused calls — one for recap, one for stakes)
4. Commits results to `data/recaps.json` and `data/stakes.json`
5. Frontend fetches these as static JSON files at startup

### Push notifications
1. User visits site → banner appears after 8 seconds → clicks "Notify me"
2. Browser registers `/sw.js` as service worker
3. Browser calls `PushManager.subscribe()` with VAPID public key
4. Frontend POSTs subscription object to `/api/subscribe`
5. `api/subscribe.js` stores subscription in Upstash Redis (key: `push:{base64_of_endpoint[-40]}`, TTL: 400 days)
6. GitHub Actions workflows call `scripts/send-notifications.ts` which fetches all `push:*` keys from Redis and sends via `web-push`

---

## ESPN API

All endpoints are public (no auth). Base domain: `https://site.api.espn.com`

| Data | Endpoint |
|---|---|
| Scoreboard | `/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD` |
| Standings | `/apis/v2/sports/soccer/fifa.world/standings` |
| Match summary | `/apis/site/v2/sports/soccer/fifa.world/summary?event={id}` |
| Player stats | `/apis/site/v2/sports/soccer/fifa.world/athletes/{id}` |

**Date format**: `YYYYMMDD` (no dashes) e.g. `20260626`

**Key fields in scoreboard response**:
- `events[].competitions[0].competitors` — home/away teams
- `competitors[].score` — current score
- `competitors[].homeAway` — `"home"` or `"away"`
- `competitions[0].details` — goal events (type, clock, athletesInvolved)
- `events[].status.type.completed` — boolean, game finished
- `events[].status.type.name` — `"STATUS_IN_PROGRESS"`, `"STATUS_FINAL"`, etc.

**Goal detection in details**:
```javascript
const goals = (comp.details || []).filter(d => {
  const t = (d.type?.text || d.type?.name || '').toLowerCase();
  return t.includes('goal') || t === 'score';
});
```

**Standings groups**: `sd.children[]` — each child has `name` (e.g. "Group A") and `standings.entries[]`

---

## AI Pipeline

### File: `scripts/generate-ai-content.ts`

Runs nightly via GitHub Actions. Uses Gemini 2.5 Flash.

### Self-gating logic

The script is triggered hourly (4–8am UTC) but skips cheaply if:
- All of yesterday's games are not yet complete (`status.type.completed === false`)
- Less than 1h 55m has passed since the last game kicked off (buffer for extra time + post-game data propagation)
- Both recap AND stakes are already generated for the target dates

```typescript
// Check: both outputs already exist
if (recapDone && stakesDone) process.exit(0);

// Check: games still in progress
const incomplete = events.filter(e => !e.status?.type?.completed);
if (incomplete.length > 0) process.exit(0);

// Check: within buffer window
const latestKickoff = Math.max(...events.map(e => new Date(e.date).getTime()));
const eligibleAt = latestKickoff + (115 + 60) * 60 * 1000; // 115min game + 60min buffer
if (Date.now() < eligibleAt) process.exit(0);
```

### Date attribution (CRITICAL — Pacific Time)

All dates are attributed in Pacific Time (`America/Los_Angeles`), not UTC. This is because late West Coast games (9pm PT kickoff) would be attributed to the next UTC day if UTC was used.

```typescript
const ptDate = (d = new Date()) =>
  d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // gives YYYY-MM-DD
```

**This is the root cause of timezone bugs in the frontend** — when the frontend looks up data by date, it must use PT, not local timezone or UTC.

### Recap generation

- Prompt: 40–50 words on results + up to 30 words on mathematical qualification/elimination certainty
- Input: goal scorers only (NOT stats like shots/possession — hallucination risk)
- Output stored in `data/recaps.json` as `[{date: "YYYY-MM-DD", summary: "..."}]`

### Stakes generation

- Prompt: 15–20 word factual pre-match context per game
- Input: current group standings + teams' remaining games
- Output stored in `data/stakes.json` as `{byDate: {"YYYY-MM-DD": {"HOME-AWAY": {summary, status}}}}`
- Match key format: `"NOR-FRA"` (3-letter abbreviations, home first)
- Status values: `"Elimination Risk"` | `"Qualification Battle"` | `"Knockout Seeding"`

### World Cup 2026 qualification rules (passed to AI)

```
48 teams, 12 groups of 4.
- Top 2 from each group qualify automatically.
- Best 8 third-place teams also advance.
- 3rd place with 4+ points: realistic best-3rd contender.
- 3rd place with ≤3 points: very unlikely to advance.
- 4th place: always eliminated.
QUALIFIED: no other team can mathematically overtake them for top-2.
ELIMINATED: cannot reach top-2 AND max possible points ≤3 with negative GD when 4pts+ needed.
```

### Gemini API usage

```typescript
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: prompt,
  config: { responseMimeType: 'application/json', temperature: 0 },
});
```

Model must be `gemini-2.5-flash` — `gemini-2.0-flash` is deprecated.

Retry logic: 5 attempts. 429 → wait 60s. 503 → wait 30s. Other → wait 5s.

---

## Push Notifications

### Architecture

```
Browser (VAPID public key in index.html)
    → PushManager.subscribe()
    → POST /api/subscribe (subscription object)
    → Upstash Redis: SET push:{key} {subscription_json} EX 34560000

GitHub Actions
    → scripts/send-notifications.ts
    → Redis: KEYS push:*
    → web-push.sendNotification(sub, payload) for each subscriber
    → On 404/410 response: DEL the key (expired subscription)
```

### VAPID Keys

Generated once with `npx web-push generate-vapid-keys`.

- **Public key**: embedded in `index.html` (visible to all users, safe)
- **Private key**: GitHub secret `VAPID_PRIVATE_KEY` only (never in code)
- Both keys must be stored as GitHub secrets: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
- Both keys must also be in Vercel environment variables (for the serverless function to send)

**Current keys** (public key only shown here — private key is in GitHub secrets):
- Public: `BPUf1P3B-5GMBEIs7WZVxy-0PhoASlUFKJslWF39BoW3Fy3BnMUXv7DmLGVOuH7uxiqfjPO1ILZWYY25VOnykrY`

**CRITICAL**: If you regenerate VAPID keys, you must:
1. Update `VAPID_PUBLIC_KEY` in `index.html`
2. Update both secrets in GitHub
3. Update both vars in Vercel
4. All existing subscriptions become invalid (different key = 401 on send) — users must re-subscribe

### Service Worker (`sw.js`)

Must live at the **root** of the domain (`/sw.js`) for correct push scope. Cannot be in a subdirectory.

```javascript
self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'Game Buddy', {
    body: data.body || '',
    icon: data.icon || '/favicon.ico',
    data: { url: data.url || 'https://game-buddy.co.uk' }
  }));
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

### iOS Safari Requirements (CRITICAL)

1. **The site must be added to the Home Screen** (Share → Add to Home Screen) before push works. Even on iOS 16.4+, `reg.pushManager` is `null` when opened in regular Safari — it only works from the installed PWA.
2. **Do NOT check `'PushManager' in window`** — this returns `false` on Safari iOS even when supported. Instead check `reg.pushManager` after registering the service worker:
   ```javascript
   const reg = await navigator.serviceWorker.register('/sw.js');
   await navigator.serviceWorker.ready;
   if (!reg.pushManager) { /* not supported */ return; }
   ```
3. Chrome on iOS does **not** support Web Push at all (Apple restriction). Safari only.

### Upstash Redis

Used to store push subscriptions. HTTP REST API — no persistent connection needed.

- URL: set as `KV_REST_API_URL` environment variable
- Token: set as `KV_REST_API_TOKEN` environment variable

**CRITICAL**: These must be set in **both** GitHub secrets (for Actions workflows) AND **Vercel environment variables** (for serverless functions). They are completely separate systems.

**REST API usage** (use JSON body format, not URL path format):
```javascript
// CORRECT — JSON body
await fetch(KV_REST_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(['SET', key, value, 'EX', ttl]),
});

// WRONG — URL path encoding breaks with large subscription objects
await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${ttl}`);
```

### `api/subscribe.js` Implementation

```javascript
// CommonJS only — see API Endpoints section
module.exports = async function handler(req, res) {
  // POST: save subscription
  const key = 'push:' + Buffer.from(sub.endpoint).toString('base64').slice(-40).replace(/[^a-zA-Z0-9]/g, '_');
  await redis('SET', key, JSON.stringify(sub), 'EX', 60 * 60 * 24 * 400); // 400 day TTL

  // On send failure (404/410): delete the key — subscription expired
};
```

### Notification Types

**Morning digest** (runs 7:00 UTC = 8:00 BST daily):
- Title: `⚽ N games today`
- Body: comma-separated list of `HOM vs AWY HH:MM` in BST

**Recap ready** (runs after overnight pipeline commits new data):
- Title: `📋 Yesterday's recap is ready`
- Body: `Tap to see the match summary and results.`
- Only fires if `data/recaps.json` was actually updated (checks `committed=true` output from git step)

---

## Frontend

### Key Global Variables

```javascript
const ESPN_URL = '/api/scoreboard';
let browseDate = null;   // null = today; Date object when browsing other days
let lastEvents = [];     // last fetched events array
let stakesCache = {};    // "YYYY-MM-DD|HOME-AWAY" → {summary, status}
let _recapRows = [];     // loaded recap rows from /api/recaps
```

### Initialization Sequence

```javascript
showSkeleton();
renderGroups();
refreshKnockoutBracket();
fetchPlayerClubs();
fetchPlayerStats();
fetchStakesData();      // loads stakes.json into stakesCache
fetchDailyRecaps();     // loads recaps into _recapRows (MUST be called — easy to miss)
fetchMatches();         // fetches ESPN scoreboard + triggers main render
fetchGroupStandings();
fetchKnockoutData();
```

**Bug that was missed**: `fetchDailyRecaps()` was defined but not called at init, so recaps never appeared.

### Recap Display Flow

1. `fetchDailyRecaps()` fetches `/api/recaps` → populates `_recapRows`
2. Every time the day is rendered, `renderSummary(container, dispDate)` is called
3. `renderSummary` looks up `_recapRows` for the current display date
4. Shows recap card if found; hides if dismissed (localStorage `recap_dismissed`)
5. For "yesterday" recap: time-gated — hides after noon local time

### Stakes Display Flow

1. `fetchStakesData()` fetches `/data/stakes.json` → populates `stakesCache`
2. Key format: `"YYYY-MM-DD|HOME-AWAY"` e.g. `"2026-06-26|NOR-FRA"`
3. `buildStakesHtml(ev)` looks up stakes for each upcoming match card
4. Injected into `.mc:not(.live):not(.ft)` cards after data loads

### `data/recaps.json` Format

```json
[
  { "date": "2026-06-12", "summary": "France beat Brazil 2-1..." },
  { "date": "2026-06-13", "summary": "Germany won..." }
]
```

Old format (pre-June 2026 backfill): `{ headline, theDrama, mustWatchHighlights, progressionNews }` — frontend handles both.

### `data/stakes.json` Format

```json
{
  "byDate": {
    "2026-06-26": {
      "NOR-FRA": { "summary": "Norway and France fight for Group I top spot.", "status": "Knockout Seeding" },
      "SEN-IRQ": { "summary": "Both sides already eliminated, playing for pride.", "status": "Elimination Risk" }
    }
  },
  "generatedAt": "2026-06-25T05:12:00.000Z"
}
```

---

## API Endpoints (Vercel Serverless)

### CRITICAL: CommonJS Requirement

`api/package.json` contains `{ "type": "commonjs" }`. This means **all files in `api/` must use CommonJS syntax**. ES module syntax (`import`/`export`) will cause a silent crash with `FUNCTION_INVOCATION_FAILED`.

```javascript
// CORRECT
const something = require('something');
module.exports = async function handler(req, res) { ... };

// WRONG — crashes silently
import something from 'something';
export default async function handler(req, res) { ... }
```

**Workaround**: For packages that need to be imported (like `@upstash/redis`), use the package's HTTP REST API directly with `fetch` instead. Node 18+ (Vercel default) has `fetch` built-in — no import needed.

### `api/_proxy.js`

Reusable proxy factory. All ESPN proxies use this.

```javascript
module.exports = function createProxy(espnUrl) {
  return async function(req, res) {
    // Cache-Control: no-store prevents Safari PWA caching live data
    // s-maxage=10 allows Vercel CDN to cache for 10 seconds
    res.setHeader('Cache-Control', 'no-store, s-maxage=10, stale-while-revalidate=10');
    // ...proxy logic
  };
};
```

**Bug that was fixed**: Originally only had `s-maxage=10` without `no-store`. Safari PWA mode was caching yesterday's scores and showing stale data.

### `api/subscribe.js`

Stores/removes Web Push subscriptions in Upstash Redis.

- `POST` with subscription JSON body → stores with 400-day TTL
- `DELETE` with `{endpoint}` body → removes
- Uses direct fetch to Upstash REST API (no package import — avoids CommonJS issue)

### Request body parsing

Vercel's `@vercel/node` runtime automatically parses JSON request bodies when `Content-Type: application/json`. No `body-parser` needed.

---

## GitHub Actions Workflows

### `overnight-ai-sync.yml`

Runs hourly 4–8am UTC. Generates recaps and stakes.

```yaml
schedule:
  - cron: '0 4 * * *'
  - cron: '0 5 * * *'
  - cron: '0 6 * * *'
  - cron: '0 7 * * *'
  - cron: '0 8 * * *'
```

Steps:
1. Run `npm run pipeline:generate` (with optional `--date=YYYY-MM-DD` and `--force` inputs)
2. `git add data/recaps.json data/stakes.json`
3. If changes exist: commit, `git pull --rebase origin main`, push
4. If commit happened AND not `--force`: run `npm run notify:recap`

**Merge conflict prevention**: The pipeline is self-gating so only one run per night should produce changes. If running backfill for multiple dates, run them all sequentially in a single job (not parallel jobs) to avoid merge conflicts on `data/stakes.json`.

### `morning-digest.yml`

Runs at 7:00 UTC (8:00 BST) daily.

```yaml
schedule:
  - cron: '0 7 * * *'
```

Runs `npm run notify:digest` which fetches today's ESPN fixtures and sends to all Redis subscribers.

---

## Environment Variables

| Variable | Where needed | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | GitHub secret | Gemini AI API access |
| `VAPID_PUBLIC_KEY` | GitHub secret + Vercel env | VAPID public key for push |
| `VAPID_PRIVATE_KEY` | GitHub secret + Vercel env | VAPID private key for push |
| `KV_REST_API_URL` | GitHub secret + Vercel env | Upstash Redis URL |
| `KV_REST_API_TOKEN` | GitHub secret + Vercel env | Upstash Redis auth token |
| `APP_URL` | GitHub secret + Vercel env | Production URL (e.g. `https://game-buddy.co.uk`) |

**CRITICAL**: GitHub secrets and Vercel environment variables are completely separate. Setting one does NOT set the other. Both must be configured independently.

---

## Timezone Bugs — Critical Section

The pipeline stores all dates in **Pacific Time (PT / America/Los_Angeles)**. The frontend must use PT when looking up pipeline-stored data. Using UTC (`toISOString()`) or local timezone for these lookups causes mismatches for non-PT users (e.g. UK users in BST are UTC+1).

### The Rule

| Data source | Date timezone to use in frontend |
|---|---|
| ESPN API calls (scoreboard, standings) | Local timezone is fine |
| `data/stakes.json` key lookup | **Pacific Time** |
| `data/recaps.json` key lookup | **Local timezone** (or PT — both work since dates are calendar days) |
| "Yesterday" scores card | **Local timezone** |

### Correct pattern for PT date

```javascript
// CORRECT: Pacific Time date string
const ptDate = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
// en-CA locale gives YYYY-MM-DD format

// WRONG: UTC date
const utcDate = d.toISOString().slice(0, 10);

// WRONG: local date (for PT-stored data)
const localDate = `${d.getFullYear()}-${...}`;
```

### Bugs fixed

**Bug 1 — Stakes lookup wrong date** (affected all non-PT users):
- Location: `buildStakesHtml(ev)` in `index.html`
- Problem: used local date components to build the stakes cache key
- Symptom: stakes summaries missing for games that span UTC midnight (e.g. 8pm BST = midnight UTC+1 next day for some games)
- Fix: `d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })`

**Bug 2 — Yesterday scores wrong date** (affected BST users after midnight BST):
- Location: `renderYesterdayScores()` in `index.html`
- Problem: `yd.toISOString().slice(0,10)` gives UTC yesterday, not local yesterday
- Symptom: wrong day's scores shown in "Yesterday" banner
- Fix: `yd.toLocaleDateString('en-CA')` (local timezone, not PT — we want local "yesterday")

**Bug 3 — Recap lookup wrong date** (affected BST users):
- Location: `renderSummary()` in `index.html`
- Problem: same UTC date issue in todayStr/yesterdayStr/dispDate calculations
- Fix: replaced all `toISOString().slice(0,10)` with `toLocaleDateString('en-CA')`

**Bug 4 — Pipeline date attribution**:
- Location: `scripts/generate-ai-content.ts`
- Problem: using UTC midnight as day boundary attributed late games to the next day
- Fix: use PT for all date calculations in the pipeline

---

## Full Bug History

### Merge conflicts on parallel pipeline runs
- **Cause**: Triggered 12 recap-generation GitHub Actions runs simultaneously for backfill, all trying to push to `data/stakes.json`
- **Fix**: Run all dates sequentially in a single job, not as parallel jobs
- **Pattern**: `for DATE in 2026-06-12 ... 2026-06-22; do npm run pipeline:generate -- --date=$DATE --force; done`

### `index.html` accidentally overwritten (2878 bytes)
- **Cause**: Used `mcp__github__push_files` with `content: "PLACEHOLDER"`, then tried to fix with `mcp__github__create_or_update_file` but only pushed the web push script section (~2878 bytes)
- **Symptom**: Site completely blank — entire app replaced with a tiny script
- **Fix**: Checked out correct version from feature branch with `git checkout [branch] -- index.html`
- **Lesson**: Never use `mcp__github__push_files` or `mcp__github__create_or_update_file` for large files. Use git locally and push via git.

### `fetchDailyRecaps()` never called
- **Cause**: Function was defined but not added to the init sequence
- **Symptom**: Recap cards never appeared on any day
- **Fix**: Added `fetchDailyRecaps()` call in the init block alongside `fetchStakesData()`

### `fetchDailyRecaps()` disabled with `return;`
- **Cause**: Was disabled mid-session with comment "data under review"
- **Symptom**: Same as above — recaps never appeared
- **Fix**: Removed the early `return;`

### Safari PWA showing cached/stale data
- **Cause**: `api/_proxy.js` only had `s-maxage=10` (CDN cache), no browser cache prevention
- **Symptom**: Safari opened from home screen showed yesterday's match data
- **Fix**: Added `no-store` to Cache-Control: `'no-store, s-maxage=10, stale-while-revalidate=10'`

### `api/subscribe.js` silent 500 crash
- **Cause**: File used ES module `import` syntax but `api/package.json` forces CommonJS
- **Symptom**: Every subscription attempt returned 500, nothing saved to Redis
- **Fix**: Rewrote using CommonJS `module.exports` and direct `fetch()` to Upstash REST API

### VAPID key mismatch
- **Cause**: Regenerated VAPID keys but didn't update them consistently across index.html, GitHub secrets, and Vercel env vars
- **Symptom**: Push sends returned 401 Unauthorized
- **Fix**: Must update all three locations atomically. Old subscriptions become invalid and users must re-subscribe.

### iOS Safari push not working in browser
- **Cause**: Checked `'PushManager' in window` which returns `false` in Safari even on iOS 16.4+
- **Symptom**: "Push notifications not supported" alert despite being on iOS 16.4
- **Fix**: Register service worker first, then check `reg.pushManager`

### iOS Safari push not working from browser (PWA required)
- **Cause**: iOS requires the site to be installed as a PWA (Add to Home Screen) before push is allowed
- **Symptom**: Even with correct checks, `reg.pushManager` is `null` when opened in regular Safari
- **Fix**: User must add site to Home Screen and open from there

### Morning digest wrong env vars
- **Cause**: Workflow was created with old OneSignal env var names (`ONESIGNAL_APP_ID` etc.) instead of VAPID/KV vars
- **Symptom**: `No key set vapidDetails.publicKey` error
- **Fix**: Updated workflow to use correct env var names

### Upstash URL encoding for SET command
- **Cause**: Used URL path format `POST /set/key/value` but large push subscription objects broke URL encoding
- **Symptom**: 400 errors from Upstash when saving subscriptions
- **Fix**: Use JSON body format: `POST /` with body `["SET", "key", "value", "EX", ttl]`

### Stakes `status` pills removed by request
- **Location**: `buildStakesHtml()` in `index.html`
- The "KNOCKOUT SEEDING" / "ELIMINATION RISK" / "QUALIFICATION BATTLE" pill badges were removed — only the summary text remains

---

## Premier League Rebuild Notes

### What to keep the same
- Single HTML file architecture (fast, no build step for frontend)
- Vercel hosting + serverless proxy pattern
- `api/package.json` with `"type": "commonjs"` (keep all API functions consistent)
- Upstash Redis for push subscriptions (proven pattern)
- Web Push via VAPID (works on Android Chrome + iOS Safari PWA)
- GitHub Actions for overnight content generation
- Gemini 2.5 Flash for AI content

### What to change for Premier League
- **ESPN API endpoint**: Replace `fifa.world` with the relevant Premier League sport identifier. ESPN covers EPL — test: `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard`
- **Season structure**: Premier League is 38 matchdays, not a group stage. No qualification/elimination logic needed.
- **AI prompt**: Replace World Cup qualification rules with PL-specific context (title race, top-4, relegation, European spots)
- **Stakes logic**: Focus on table position implications, not group advancement
- **Date attribution**: PL games are UK-based, consider using GMT/BST instead of PT for pipeline dates
- **Gemini model**: Keep `gemini-2.5-flash` — don't use `gemini-2.0-flash` (deprecated)

### Timezone strategy for Premier League
Since PL games are in the UK (GMT/BST), consider attributing pipeline dates in **GMT/BST** instead of PT. This would eliminate the BST/UTC mismatch entirely for UK users. Formula:
```typescript
const ukDate = (d = new Date()) =>
  d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
```
Then in frontend, look up stakes/recaps using `{ timeZone: 'Europe/London' }` instead of `America/Los_Angeles`.

### Re-subscription on rebuild
If you deploy a new VAPID key pair (as you will for a new app), all World Cup subscribers need to re-subscribe. There's no migration path — just launch fresh.

### Environment checklist for new app
- [ ] Generate new VAPID key pair: `npx web-push generate-vapid-keys`
- [ ] New Upstash Redis database (free tier is fine)
- [ ] GitHub secrets: `GEMINI_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `APP_URL`
- [ ] Vercel env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `APP_URL`
- [ ] `sw.js` at domain root
- [ ] `vercel.json` lists `sw.js` as static build
- [ ] `api/package.json` with `{"type": "commonjs"}`
