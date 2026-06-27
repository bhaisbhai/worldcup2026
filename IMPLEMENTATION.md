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

GitHub Actions (nightly, 4–12am UTC window — see cron delay note)
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
├── keepy-uppy.js           ← Browser mini-game (keepy-uppy) served as static
├── vercel.json             ← Vercel build + routing config
├── package.json            ← "type": "module" (ESM) — scripts use ESM import/export
├── data/
│   ├── recaps.json         ← AI-generated match recaps (committed by pipeline)
│   ├── stakes.json         ← AI-generated pre-match stakes (committed by pipeline)
│   ├── player-stats.json   ← Tournament player stats per athlete ID (run via player-stats-sync.yml)
│   ├── player-clubs.json   ← Player ID → club lookup via Wikidata (run via player-clubs-sync.yml)
│   ├── player-verdicts.json← AI pundit roasts/verdicts per athlete ID
│   ├── daily-summary.json  ← Older format AI daily summaries
│   ├── days_ai.csv         ← Legacy CSV (old pipeline architecture, now superseded)
│   ├── matches_ai.csv      ← Legacy CSV
│   └── teams_ai.csv        ← Legacy CSV
├── api/
│   ├── package.json        ← CRITICAL: {"type":"commonjs"} — all api/*.js must use CommonJS
│   ├── _proxy.js           ← Reusable ESPN proxy with cache headers
│   ├── subscribe.js        ← Web push subscription storage (POST/DELETE)
│   ├── recaps.js           ← Serves data/recaps.json (bundled at Vercel deploy time)
│   ├── scoreboard.js       ← Proxies ESPN scoreboard
│   ├── standings.js        ← Proxies ESPN standings
│   ├── playerstats.js      ← Live player stat leaders (reads ESPN match summaries on-demand)
│   ├── leaders.js          ← Proxies ESPN leaders endpoint
│   ├── summary.js          ← Proxies ESPN match summary endpoint
│   ├── statistics.js       ← ESPN v4 statistics endpoint with fallback URL
│   ├── highlights.js       ← YouTube API proxy for match highlights
│   ├── game-scores.js      ← Redis sorted-set leaderboard for keepy-uppy mini-game
│   ├── health.js           ← Simple health check {ok:true, ts:...}
│   ├── debug.js            ← ESPN response shape inspector (dev tool, not for production)
│   └── test-push.js        ← Debug push sender (SHOULD BE DELETED — publicly accessible)
├── scripts/
│   ├── generate-ai-content.ts       ← Main nightly pipeline (recaps + stakes)
│   ├── send-notifications.ts        ← Push notification sender (digest + recap)
│   ├── generate-player-stats.ts     ← Aggregates ESPN match summaries → data/player-stats.json
│   ├── generate-player-clubs.ts     ← ESPN rosters + Wikidata SPARQL → data/player-clubs.json
│   ├── generate-retrospective-days.ts   ← Historical backfill for recaps
│   ├── generate-offline-verdicts.ts     ← Template-based offline player verdict generator
│   ├── backfill-master.ts               ← General backfill utility
│   ├── generate-retrospective-matches.ts
│   ├── generate-retrospective-teams.ts
│   └── update-player-clubs.cjs          ← CJS update utility for player clubs
└── .github/workflows/
    ├── overnight-ai-sync.yml          ← Nightly recap + stakes generation (4–12am UTC)
    ├── morning-digest.yml             ← Daily 8am fixture notification
    ├── player-stats-sync.yml          ← Manual: aggregates player tournament stats
    ├── player-clubs-sync.yml          ← Manual: refreshes player→club Wikidata lookup
    ├── backfill-recaps.yml            ← Manual: sequential multi-date recap backfill
    └── send-recap-notification.yml    ← Manual: sends recap push notification standalone
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

### Player stats (tournament-wide)
1. Manually triggered via `player-stats-sync.yml` (or run locally with `npm run pipeline:stats`)
2. `scripts/generate-player-stats.ts` fetches every completed match scoreboard from ESPN
3. For each match, fetches the match summary and parses `rosters[].roster[].stats[]`
4. Aggregates per athlete ID: goals, assists, shots, saves, yellow/red cards, minutes played
5. Commits result to `data/player-stats.json` (keyed by ESPN athlete ID)
6. Frontend uses this for the player profile modal

### Player clubs lookup
1. Manually triggered via `player-clubs-sync.yml`
2. `scripts/generate-player-clubs.ts` fetches all 48 WC2026 team rosters from ESPN
3. Runs Wikidata SPARQL query in batches of 80 to find each player's current club
4. Falls back to individual Wikidata entity search for any player SPARQL missed
5. Commits result to `data/player-clubs.json` (keyed by ESPN athlete ID)
6. Frontend uses this to show "Club: Manchester City" in player profiles

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
| Leaders | `/apis/site/v2/sports/soccer/fifa.world/leaders` |
| Statistics | `/apis/v4/sports/soccer/fifa.world/statistics?season=2026` (falls back to no season param) |
| Team roster | `/apis/site/v2/sports/soccer/fifa.world/teams/{id}/roster` |
| All teams | `/apis/site/v2/sports/soccer/fifa.world/teams?limit=100` |

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

The script is triggered hourly (4–12am UTC) but skips cheaply if:
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

### ESM vs CommonJS split (CRITICAL)

The root `package.json` has `"type": "module"` — all scripts in `scripts/` use **ESM** (`import`/`export`). But `api/package.json` has `"type": "commonjs"` — all serverless functions in `api/` use **CommonJS** (`require`/`module.exports`). These two halves of the codebase use different module systems.

**ESM gotcha in scripts**: `__dirname` and `__filename` don't exist in ESM. Must use:
```typescript
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```
This was the root cause of all `ReferenceError: __dirname is not defined` crashes on GitHub Actions (originally written on Mac where this may have been masked).

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

### `vercel.json` key details

```json
{
  "builds": [
    { "src": "api/recaps.js", "use": "@vercel/node", "config": { "includeFiles": ["data/**"] } },
    { "src": "api/**/*.js", "use": "@vercel/node" },
    { "src": "data/**", "use": "@vercel/static" },
    { "src": "sw.js", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1.js" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

**`includeFiles: ["data/**"]` on `api/recaps.js`**: `api/recaps.js` uses `require('../data/recaps.json')` — which resolves the path at **build time**. Without `includeFiles`, Vercel doesn't bundle the data files with the function and it crashes. This config ensures `data/` is available to the function at runtime.

**Static `data/**`**: Data files are also served directly as static assets at `/data/recaps.json` etc. The frontend can fetch either `/api/recaps` (function) or `/data/recaps.json` (static) — both serve the same data. The static route is preferred for performance (CDN-cached).

**Catch-all SPA route**: `{ "src": "/(.*)", "dest": "/index.html" }` — all paths that don't match a file or API route fall through to `index.html`. This enables client-side routing.

**`api/recaps.js` deploys at build time**: `const recaps = require('../data/recaps.json')` — the JSON is bundled into the function at deploy time. Changes to `data/recaps.json` require a new Vercel deploy before they're reflected via `/api/recaps`. The static `/data/recaps.json` URL updates immediately when the file is committed.

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

### `api/highlights.js` — YouTube proxy

Proxies YouTube Data API v3. Requires `YOUTUBE_API_KEY` environment variable.

```javascript
// Two modes:
// mode=catalog → fetches BBC Sport uploads playlist (hard-coded playlist ID)
// q=<query>    → YouTube search for match highlights
GET /api/highlights?mode=catalog
GET /api/highlights?q=France+vs+Norway+highlights
```

Cache: `public, s-maxage=3600, stale-while-revalidate=300` (1h CDN cache — YouTube quota is limited).

**`YOUTUBE_API_KEY`** must be in Vercel environment variables. Not needed in GitHub secrets (pipeline doesn't use it).

### `api/game-scores.js` — Keepy-uppy leaderboard

Redis sorted set (`ZADD kuking_leaderboard GT score member`) stores the global leaderboard for the `keepy-uppy.js` browser mini-game.

```javascript
GET /api/game-scores  → top 10 scores
POST /api/game-scores { name, score, combo, perfects } → submit score
```

- Uses `ZADD KEY GT score member` — only updates if new score is higher than existing
- `ZREMRANGEBYRANK KEY 0 -501` keeps only top 500 entries
- Uses Upstash Redis pipeline endpoint for atomic multi-command execution
- Accepts both `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` and `KV_REST_API_URL`/`KV_REST_API_TOKEN` env var names (same Redis instance, just two naming conventions)

### `api/debug.js` — ESPN response shape inspector

Dev tool that hits the ESPN standings and statistics endpoints and returns metadata about the response shapes (top-level keys, first category name, first entry structure). Used to verify what ESPN is actually returning without reading raw JSON. **Not for production use** — slow and uncached.

### `api/test-push.js` — SHOULD BE DELETED

A debug endpoint that sends a test push notification. It's publicly accessible at `/api/test-push`. Anyone who finds this URL can send push notifications to all subscribers. **Delete this file.**

---

## Player Stats Systems

There are two separate player stats systems in this codebase. They serve different purposes.

### System 1: `api/playerstats.js` (live, on-demand)

Fetches data from ESPN match summaries on every API call. Returns top 10 leaders per category (goals, assists, yellow cards, red cards, clean sheets). Used for the "Top Scorers" leaderboard tab.

- **Reads from**: ESPN `summary?event={id}` endpoints live on each request
- **Writes to**: nothing (pure proxy aggregator)
- **Cap**: `matches.slice(0, 120)` — covers up to 120 completed matches
- **Stat name variants**: handles `goals`/`totalGoals`/`goalsScored`, `goalAssists`/`assists`, etc.
- **Cache**: `s-maxage=300, stale-while-revalidate=600` (5 min CDN cache)

### System 2: `scripts/generate-player-stats.ts` + `data/player-stats.json` (aggregated, static)

Runs manually via `player-stats-sync.yml`. Fetches all match summaries for the entire tournament and aggregates full stats per player by ESPN athlete ID. Used for the player profile modal.

- **Reads from**: ESPN scoreboard (to get match IDs) + ESPN summary (to get roster + stats)
- **Writes to**: `data/player-stats.json` — keyed by ESPN athlete ID
- **Data per player**: `appearances`, `goals`, `assists`, `shots`, `shotsOnTarget`, `saves`, `yellowCards`, `redCards`, `minutesPlayed`, `headshot`
- **Run frequency**: manually as needed (not automated daily)
- **Stat name used**: `totalGoals`, `goalAssists`, `totalShots`, `shotsOnTarget`, `saves`, `yellowCards`, `redCards`, `minutesPlayed`

**INCONSISTENCY WARNING**: `generate-player-stats.ts` uses `totalGoals` as the stat name but doesn't handle multiple variants the way `api/playerstats.js` does. If ESPN changes stat names mid-tournament, `player-stats.json` could silently accumulate 0s. Consider adding multi-variant `getStat()` to this script too.

---

## Wikidata Integration (Player Clubs)

`scripts/generate-player-clubs.ts` fetches players' current club teams from Wikidata, since ESPN rosters don't include club affiliation.

### Flow

1. Fetch all 48 WC2026 teams from ESPN `teams?limit=100`
2. For each team, fetch its roster from ESPN `teams/{id}/roster`
3. Collect all player names that don't have a club yet
4. **Pass 1 — Batch SPARQL**: query Wikidata in batches of 80 names using SPARQL
5. **Pass 2 — Fallback search**: for any player SPARQL missed, search Wikidata entity API individually
6. Write results to `data/player-clubs.json` keyed by ESPN athlete ID

### Wikidata SPARQL query

```sparql
SELECT DISTINCT ?searchName ?clubLabel WHERE {
  VALUES ?searchName { "Kylian Mbappé"@en ... }
  ?player rdfs:label ?playerLabel .
  FILTER(LCASE(STR(?playerLabel)) = LCASE(STR(?searchName)) && LANG(?playerLabel) = "en")
  ?player wdt:P106 wd:Q937857 .   ← occupation = football player
  ?player p:P54 ?stmt .            ← member of sports team
  ?stmt ps:P54 ?club .
  FILTER NOT EXISTS { ?stmt pq:P582 [] }   ← no end date (still current)
  FILTER NOT EXISTS { ?club wdt:P31 wd:Q17156793 }  ← not a national team
  ?club rdfs:label ?clubLabel FILTER(LANG(?clubLabel) = "en")
}
```

### Rate limits
- Wikidata requests `>= 1 second` between SPARQL requests (enforced with `sleep(1500)` between batches)
- `sleep(300)` between individual fallback lookups
- SPARQL endpoint: `https://query.wikidata.org/sparql`

### data/player-clubs.json format
```json
{
  "12345": { "name": "Kylian Mbappé", "club": "Real Madrid", "teamName": "France", "teamAbbr": "FRA", "position": "F", "jersey": "10" }
}
```

### PL rebuild note
Wikidata SPARQL will work equally well for Premier League players. The key Wikidata properties (`P54` = member of sports team, `P582` = end time, `P31`/`Q17156793` = national team type) apply globally.

---

## Mini-game: Keepy-Uppy

`keepy-uppy.js` is a standalone browser game served as a static file. It posts high scores to `/api/game-scores` which stores them in a Redis sorted set.

- Global leaderboard: top 500 scores, only improves (ZADD GT)
- Leaderboard data per entry: `name`, `score`, `combo`, `perfects`, `date` (stored as JSON member in sorted set)
- Frontend fetches top 10 via `GET /api/game-scores`
- No authentication on score submission — scores are unverified

---

## GitHub Actions Workflows

### `overnight-ai-sync.yml`

Runs hourly 4–12am UTC. Generates recaps and stakes. Self-gating means extra cron slots are free — script exits immediately if both outputs already exist.

```yaml
schedule:
  - cron: '0 4 * * *'
  - cron: '0 5 * * *'
  - cron: '0 6 * * *'
  - cron: '0 7 * * *'
  - cron: '0 8 * * *'
  - cron: '0 9 * * *'
  - cron: '0 10 * * *'
  - cron: '0 11 * * *'
  - cron: '0 12 * * *'
```

**CRITICAL — GitHub Actions cron delay**: GitHub's scheduled jobs routinely run 2-3 hours late under load. A 4-8 UTC window can be entirely missed. The 4-12 UTC window gives 9 attempts, absorbing worst-case delays. When the pipeline hasn't run by 9am UTC and games finished at 22:00 UTC the night before, manually trigger via `workflow_dispatch`.

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

Runs `npm run notify:digest` which fetches today's ESPN fixtures and sends to all Redis subscribers. Kick-off times are formatted in **BST (Europe/London)** for the UK audience, even though the pipeline uses PT for date attribution.

### `player-stats-sync.yml`

Manual only (`workflow_dispatch`). No schedule. Run when player stats need refreshing.

Steps: checkout → npm ci → `npm run pipeline:stats` → `git add data/player-stats.json` → commit + push.

### `player-clubs-sync.yml`

Manual only (`workflow_dispatch`). Run when player club data needs refreshing (e.g. mid-tournament transfers, new roster additions).

Steps: checkout → npm ci → `npm run pipeline:clubs` → `git add data/player-clubs.json` → commit + push.

### `backfill-recaps.yml`

Manual only (`workflow_dispatch`). Runs the pipeline sequentially for a hard-coded list of historical dates. Critical design: all dates run in **one job**, not parallel jobs — prevents merge conflicts on `data/stakes.json`.

```bash
for DATE in 2026-06-12 2026-06-13 ... 2026-06-22; do
  npm run pipeline:generate -- --date=$DATE --force
done
```

Then a single `git add data/recaps.json data/stakes.json && git commit` at the end. Uses `git pull --rebase origin main` before push to absorb any concurrent changes.

### `send-recap-notification.yml`

Manual only (`workflow_dispatch`). Sends the "recap ready" push notification without re-running the full pipeline. Use this when the nightly pipeline ran correctly but the notification step was missed (e.g. due to a `--force` flag issue or the pipeline being triggered at an unusual time).

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
| `YOUTUBE_API_KEY` | Vercel env only | YouTube Data API v3 key (for `api/highlights.js`) |

**CRITICAL**: GitHub secrets and Vercel environment variables are completely separate. Setting one does NOT set the other. Both must be configured independently.

**`YOUTUBE_API_KEY` notes**: YouTube Data API v3 has a daily quota of 10,000 units. `playlistItems.list` costs 1 unit; `search.list` costs 100 units. Cache the highlights response for 1+ hours to stay within quota (already done: `s-maxage=3600`). The API key must be created in Google Cloud Console and restricted to the `youtube.data.googleapis.com` API.

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

### Upcoming match cards expand on auto-refresh (padding jump)
- **Cause**: `patchCard()` resets `card.className` without preserving the `up` class. Upcoming cards use `.mc.up` (`padding:12px 15px`); dropping `up` falls back to `.mc` (`padding:17px 19px`), causing a visible expansion every 10–30 seconds.
- **Symptom**: Visible when browsing any date that has upcoming matches — cards briefly grow then the layout shifts. Triggered by navigating between dates (which resets the refresh cycle), making it look like a date-navigation bug.
- **Fix**: Added `const isUp = ev.state==='pre'` in `patchCard` and changed:
  ```js
  // before (broken):
  card.className = `mc${isLive?' live':isFt?' ft':''} vis`;
  // after (fixed):
  card.className = `mc${isLive?' live':isFt?' ft':isUp?' up':''} vis`;
  ```
- **File**: `patchCard()` in `index.html`

### AI recap `progression` field was a cumulative team list, not contextual news
- **Cause**: Prompt asked to "list every team now MATHEMATICALLY GUARANTEED to have qualified or been ELIMINATED" — this produces a growing laundry list of all teams ever qualified/eliminated, not what changed today.
- **Symptom**: Progression section showed every qualified/eliminated team across the whole tournament, not just what changed as a result of today's games.
- **Fix**: Changed prompt to: "As a result of TODAY's games only, which teams have NEWLY qualified for or been eliminated? Write 1-2 sentences of news narrative. If no team changed status today, return empty string."
- **File**: `recapPrompt` in `scripts/generate-ai-content.ts`

### AI calling teams ELIMINATED when they still had a slim best-3rd chance
- **Cause**: The `ELIMINATED` rule in `qualRules` said "max possible points ≤ 3 with negative GD" — but 3 points with a good GD can still qualify as best-3rd (8 of 12 third-place teams advance). Senegal with 0pts and 1 game left was incorrectly called eliminated.
- **Symptom**: Progression section stated teams were out when they still had a mathematical path via the best-3rd route.
- **Fix**: Tightened the ELIMINATED condition to only fire when max possible points is 0 or 1 — making best-3rd mathematically impossible. Added "when in doubt, do NOT call a team eliminated."
- **File**: `qualRules` constant in `scripts/generate-ai-content.ts`
- **Key rule**: Best-3rd threshold is roughly 4 pts (solid) or 3 pts (slim but real). Never call ELIMINATED unless it's arithmetically impossible, not just unlikely.

### Recap notification skipped when pipeline triggered with `--force`
- **Cause**: The notification step in `overnight-ai-sync.yml` had condition `if: steps.commit.outputs.committed == 'true' && github.event.inputs.force != 'true'`. The `force` flag is for skipping readiness checks, not for suppressing notifications — but it was silently blocking them during manual backfill runs.
- **Symptom**: User never received recap notification after backfill runs were triggered manually.
- **Fix**: Removed `&& github.event.inputs.force != 'true'` from the condition. Notifications now fire whenever data was actually committed, regardless of how the pipeline was triggered.
- **File**: `.github/workflows/overnight-ai-sync.yml`
- **Also added**: `.github/workflows/send-recap-notification.yml` — a standalone `workflow_dispatch` workflow to manually send the recap notification if one is ever missed again, without needing to re-run the full pipeline.

### Header wordmark wraps when "Refreshing…" text appears
- **Cause**: The refresh label changes from "↻ Refresh" to "↻ Refreshing…" (wider text), squeezing the flex container and causing "CUP" in "FIFA WORLD CUP 2026" to wrap to a new line.
- **Symptom**: Glitchy one-line-to-two-line jump in the header wordmark every time a refresh fires.
- **Fix**: Stopped changing the label text entirely. The ↻ icon now spins via CSS animation (`@keyframes spin`) when `.fetching` class is applied, and the text stays "↻ Refresh" always. Zero layout shift.
- **File**: `.refresh-label` CSS + `setRefreshLabel()` in `index.html`
- **Note**: Attempted `white-space:nowrap` + `flex-shrink:0` first — this caused horizontal overflow and pushed the entire page right on mobile. The correct fix is never changing the text width.

### Original pipeline used hardcoded Mac paths — broke on GitHub Actions
- **Cause**: `generate-ai-content.ts` and `generate-retrospective-days.ts` were written locally on Mac with absolute paths like `/Users/rajarjan/Documents/game buddy/public/assets/ai/ai_master.json`. GitHub Actions runner (Ubuntu) doesn't have these paths.
- **Symptom**: Pipeline crash on first GitHub Actions run with `ENOENT: no such file or directory`.
- **Fix**: Replaced all absolute paths with `path.resolve(__dirname, '..', ...)` using the ESM-compatible `__dirname = path.dirname(fileURLToPath(import.meta.url))` pattern.
- **Also fixed same session**: `gemini-3.5-flash` (doesn't exist) → `gemini-2.0-flash`, then later `gemini-2.5-flash`. The original model name was a typo from development.

### Old pipeline architecture: ai_master.json + CSV → data/recaps.json
- **Original design**: The AI pipeline wrote to `public/assets/ai/ai_master.json` (master database) and `public/assets/ai/csv/days_ai.csv`. The frontend read from there.
- **Problem**: The recap card UI fetches from `/api/recaps` (backed by `data/recaps.json`), which was never updated by the pipeline. AI output never reached the UI.
- **Fix**: Added code to `generate-ai-content.ts` to also write to `data/recaps.json` after every successful AI call. This is now the canonical output format.
- **Current state**: The legacy CSV and master JSON files still exist (`data/days_ai.csv`, `data/matches_ai.csv`, `data/teams_ai.csv`) but are no longer the primary data source. The pipeline writes exclusively to `data/recaps.json` and `data/stakes.json`.
- **PL rebuild**: Start fresh with just `recaps.json` + `stakes.json`. Don't carry over the old CSV format.

### `send-notifications.ts` uses `@upstash/redis` package but `api/subscribe.js` uses direct fetch
- **Cause**: Two different Redis access patterns in the same codebase. `scripts/send-notifications.ts` imports `@upstash/redis` package. `api/subscribe.js` uses direct `fetch()` to the Upstash REST API (to avoid the CommonJS ESM import issue).
- **Both work** — Upstash Redis supports both patterns. The inconsistency is cosmetic but worth noting.
- **PL rebuild**: Pick one pattern and stick with it. Direct `fetch()` is safer in `api/` (avoids CommonJS/ESM issues). `@upstash/redis` is cleaner in TypeScript scripts.

### GitHub Actions cron window too narrow — pipeline missing entirely
- **Cause**: Original schedule only ran 4-8am UTC. GitHub Actions cron can be 2-3+ hours late. On days with heavy GitHub load the 4-8 UTC window was completely missed — zero runs.
- **Symptom**: `data/recaps.json` not updated by 9am BST even though last night's games finished by 22:00 UTC. Users see "no recap today."
- **Fix**: Extended cron window to 4-12am UTC (9 hourly slots). Self-gating (`recapDone && stakesDone`) makes extra slots free — the script exits in milliseconds if work is already done.
- **Lesson for PL rebuild**: Whatever window you set, assume 3h delay. Final game ends at 22:00 UK time → processing needed by 01:00 UTC → cron window should start at 01:00 UTC and run until at least 07:00 UTC.

### `data/recaps.json` missing `progression` field broke `alreadyAnnouncedText`
- **Cause**: Early recap entries (e.g. June 24, June 25) were committed without a `progression` field, either because the pipeline didn't generate one or it wasn't in the original format. The pipeline builds `alreadyAnnouncedText` from all prior `progression` fields to prevent re-announcing already-known qualification statuses. Missing fields meant those teams were unknown to the AI and it re-announced them.
- **Symptom**: Day N recap said "Switzerland qualified today" when Switzerland actually qualified on day N-2. Also caused the AI to omit newly qualified teams from the current day because it had no context to distinguish "new" from "old."
- **Fix**: Manually added accurate `progression` fields to all historical entries, e.g. for June 24: `"progression": "Switzerland, Canada, Morocco, Brazil, Mexico, and South Africa all secured automatic knockout stage berths..."`. For entries that predate the `progression` field, the pipeline falls back to the full `summary` text — so verify summary text also doesn't silently omit team statuses.
- **Verification step**: Before trusting the pipeline's output, cross-check each `progression` field in `recaps.json` against the actual match results for that date. The AI is right ~80% of the time but will miss edge cases like best-third qualification, head-to-head tiebreakers, or teams that qualified by another team's result.

### AI recap incorrectly reported Cape Verde qualified on wrong date / missed Saudi Arabia eliminated
- **Cause**: On June 26, Group J completed: Spain won (1st, already announced), Cape Verde drew 0-0 with Saudi Arabia (3pts → 2nd, newly qualified), Saudi Arabia (2pts, 4th on head-to-head GD → eliminated). The AI correctly identified Iraq and New Zealand as eliminated (Group I and K fourth-place) but missed the Group J resolution entirely.
- **Root cause**: Group J standings tiebreaker (URU 2pts vs KSA 2pts on GD -1 vs -4) required arithmetic the AI sometimes skips. Also CPV qualifying via a draw while only getting 3 total points is counterintuitive when other groups needed 4pts for second place.
- **Fix**: Manually updated June 26's `progression` field in `recaps.json` and pushed to `main`.
- **Lesson**: Always manually verify the pipeline's `progression` output on final matchday of any group. Head-to-head tiebreakers and best-third calculations are the highest-risk cases.

### ESPN player stats match cap too low (50 → 120)
- **Cause**: `api/playerstats.js` had `matches.slice(0, 50)` but WC2026 has 96 matches in the group stage alone. Only the first 50 completed games were scored, so mid-tournament stats were incomplete.
- **Symptom**: Top scorers leaderboard missing goals for players who scored in matches 51-96.
- **Fix**: Changed cap to `matches.slice(0, 120)`.
- **Lesson for PL rebuild**: Set the cap to at least `matchdays × games_per_matchday × 2` as a buffer. PL has ~380 matches per season; cap at 400+.

### ESPN player stats wrong stat name keys
- **Cause**: ESPN's match summary API returns player stats under different key names depending on the source section (`rosters[].roster[].stats[]` vs `boxscore.players[]`). Goal stat name can be `goals`, `totalGoals`, or `goalsScored`. Assist stat can be `goalAssists` or `assists`.
- **Symptom**: Top scorers leaderboard showed 0 goals for players who scored. Depends on which ESPN internal endpoint served the data — varies by match/competition.
- **Fix**: Rewrote `getStat()` to accept multiple name variants and return the first non-zero one:
  ```javascript
  const getStat = (...names) => {
    for (const n of names) {
      const s = stats.find(x => x.name === n);
      const v = Math.round(parseFloat(s?.value ?? s?.displayValue)) || 0;
      if (v) return v;
    }
    return 0;
  };
  const goals   = getStat('goals', 'totalGoals', 'goalsScored');
  const assists = getStat('goalAssists', 'assists');
  const yellow  = getStat('yellowCards', 'yellow');
  const red     = getStat('redCards', 'red', 'redCard');
  ```
- **Lesson for PL rebuild**: Always probe multiple ESPN stat name variants. Log what keys actually come back during initial setup and hardcode all observed variants.

---

## Remote Environment / Deployment Gotchas

These apply when Claude Code runs in the managed remote execution environment (GitHub Actions trigger, web app session, etc.) rather than on a local machine.

### Git push to `main` is blocked — use `mcp__github__push_files`

In the remote environment, `git push origin main` is rejected. All pushes to `main` must go through the `mcp__github__push_files` MCP tool. This tool takes file paths and their base64-encoded contents and creates a commit directly on the remote.

```
# Wrong in remote environment:
git push origin main   ← rejected

# Correct:
mcp__github__push_files({ files: [...], message: "...", branch: "main" })
```

**Data-only changes** (like updating `data/recaps.json` and `data/stakes.json`) must be pushed this way. **Code changes** go to the feature branch (`claude/app-overview-l70sz7`) and then merge.

**After any `mcp__github__push_files` to main**: run `git fetch origin main && git reset --hard origin/main` to sync the local clone. Otherwise the local `main` diverges from remote, and later operations fail with "local commits ahead of origin."

### Stop hook: commit author email must be `noreply@anthropic.com`

A stop hook at `~/.claude/stop-hook-git-check.sh` checks that all commits on `main` have committer email `noreply@anthropic.com`. Commits made by a local `git commit` with a different email fail this check.

**Fix if it triggers**:
```bash
git config user.email noreply@anthropic.com
git config user.name Claude
git rebase --exec "git commit --amend --no-edit --reset-author" origin/main
```

**Preferred fix**: Don't create local commits on `main` at all in this environment. Push data changes directly via `mcp__github__push_files`. Use the feature branch for code changes; let the PR merge handle main.

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
- [ ] Vercel env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `APP_URL`, `YOUTUBE_API_KEY`
- [ ] `sw.js` at domain root
- [ ] `vercel.json` lists `sw.js` as static build, `data/**` as static, and `api/recaps.js` with `includeFiles: ["data/**"]`
- [ ] `api/package.json` with `{"type": "commonjs"}`
- [ ] Root `package.json` with `"type": "module"` (ESM for scripts)
- [ ] All scripts use `fileURLToPath(import.meta.url)` for `__dirname` — no absolute Mac paths
- [ ] Delete `api/test-push.js` before going live — it's a publicly accessible debug endpoint
- [ ] `data/player-clubs.json` needs to be generated before launch: run `npm run pipeline:clubs` locally
