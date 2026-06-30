# FIFA World Cup 2026 — Game Buddy

Single-page live dashboard for the 2026 FIFA World Cup. No build step. No sign-in. Free-to-air.

**Live at:** https://worldcup2026.vercel.app

---

## Table of Contents

1. [Architecture](#architecture)
2. [File Structure](#file-structure)
3. [Environment Variables & Secrets](#environment-variables--secrets)
4. [Local Development](#local-development)
5. [Deployment](#deployment)
6. [Data Flow](#data-flow)
7. [ESPN API](#espn-api)
8. [AI Pipeline (Gemini)](#ai-pipeline-gemini)
9. [GitHub Actions Workflows](#github-actions-workflows)
10. [Push Notifications](#push-notifications)
11. [API Routes (Vercel Serverless)](#api-routes-vercel-serverless)
12. [UK TV Channel Data](#uk-tv-channel-data)
13. [Frontend Architecture](#frontend-architecture)
14. [Static Data Files](#static-data-files)
15. [Scripts](#scripts)
16. [Known Gotchas](#known-gotchas)
17. [Changelog](#changelog)

---

## Architecture

```
Browser
  │
  ├─ index.html (static, Vercel CDN) — entire frontend SPA
  ├─ /data/recaps.json  (static, CDN) — AI match recaps
  ├─ /data/stakes.json  (static, CDN) — AI pre-match stakes
  └─ /api/*  (Vercel serverless) — ESPN proxy + push notifications

GitHub Actions (nightly 04:00–12:00 UTC)
  ├─ Fetches yesterday's ESPN scores
  ├─ Calls Gemini 2.0 Flash for recap + stakes text
  └─ Commits data/recaps.json + data/stakes.json → triggers Vercel deploy

Upstash Redis
  └─ Stores Web Push subscriptions (KV_REST_API_URL / KV_REST_API_TOKEN)
```

**Key constraint:** `index.html` is the *entire* frontend — one file, no bundler output served to users. Vite / TypeScript are only used for the AI pipeline scripts in `scripts/`.

---

## File Structure

```
.
├── index.html                  ← Entire SPA (HTML + CSS + JS, ~3 500 lines)
├── sw.js                       ← Service worker for Web Push notifications
├── vercel.json                 ← Vercel routing + build config
├── package.json                ← Dependencies + npm scripts for AI pipeline
├── tsconfig.json               ← TypeScript config (for scripts/ only)
├── vite.config.ts              ← Vite config (dev server only, not used in prod)
│
├── api/                        ← Vercel serverless functions (CommonJS)
│   ├── _proxy.js               ← Shared ESPN fetch helper
│   ├── scoreboard.js           ← GET /api/scoreboard → ESPN scoreboard
│   ├── summary.js              ← GET /api/summary?event=<id>
│   ├── statistics.js           ← GET /api/statistics?event=<id>
│   ├── standings.js            ← GET /api/standings
│   ├── recaps.js               ← GET /api/recaps → serves data/recaps.json
│   ├── subscribe.js            ← POST/DELETE /api/subscribe (Upstash Redis)
│   ├── highlights.js           ← GET /api/highlights?event=<id>
│   ├── leaders.js              ← GET /api/leaders
│   ├── playerstats.js          ← GET /api/playerstats
│   ├── game-scores.js          ← GET /api/game-scores
│   ├── health.js               ← GET /api/health (uptime check)
│   ├── test-push.js            ← POST /api/test-push (manual push trigger)
│   └── package.json            ← CommonJS scope fix for serverless functions
│
├── data/                       ← Static JSON committed to repo, served by CDN
│   ├── recaps.json             ← AI match recaps [{date, headline, body, ...}]
│   ├── stakes.json             ← AI pre-match stakes [{matchId, text}]
│   ├── daily-summary.json      ← Daily digest blurb
│   ├── player-clubs.json       ← Player → club mapping
│   ├── player-stats.json       ← Tournament player stats
│   ├── player-verdicts.json    ← AI player ratings/verdicts
│   └── teams_ai.csv            ← AI team summaries (CSV)
│
├── public/assets/ai/           ← Master AI database (not served directly)
│   ├── ai_master.json          ← Canonical store for all AI-generated content
│   └── csv/                    ← CSV exports (days_ai, matches_ai, teams_ai)
│
├── scripts/                    ← TypeScript pipeline scripts (run via tsx)
│   ├── generate-ai-content.ts       ← Nightly recap + stakes generator (MAIN)
│   ├── generate-retrospective-days.ts ← Backfill past day recaps
│   ├── generate-retrospective-matches.ts
│   ├── generate-retrospective-teams.ts
│   ├── generate-player-clubs.ts     ← Fetch/update player club data
│   ├── generate-player-stats.ts     ← Fetch/update player stats
│   ├── generate-offline-verdicts.ts ← Batch player verdict generation
│   ├── backfill-master.ts           ← Backfill ai_master.json from CSVs
│   └── send-notifications.ts        ← Send Web Push (digest or recap type)
│
├── .github/workflows/
│   ├── overnight-ai-sync.yml        ← Nightly recap generation (04–12 UTC)
│   ├── morning-digest.yml           ← 07:00 UTC fixture push notification
│   ├── send-recap-notification.yml  ← Manual recap push trigger
│   ├── player-clubs-sync.yml        ← Weekly player club data refresh
│   └── player-stats-sync.yml        ← Player stats sync
│
├── scratch/                    ← One-off maintenance scripts (not in prod)
└── debug-live.html / group-debug.html ← Debug views for live state / groups
```

---

## Environment Variables & Secrets

### Vercel Environment Variables

Set in Vercel Dashboard → Project → Settings → Environment Variables.

| Variable | Description |
|---|---|
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `KV_REST_API_URL` | Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Upstash Redis REST token |
| `APP_URL` | Live app URL e.g. `https://worldcup2026.vercel.app` |

### GitHub Repository Secrets

Set in GitHub → Repo → Settings → Secrets → Actions.

| Secret | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key (Gemini 2.0 Flash) |
| `VAPID_PUBLIC_KEY` | Same as Vercel — used by notify scripts |
| `VAPID_PRIVATE_KEY` | Same as Vercel — used by notify scripts |
| `KV_REST_API_URL` | Same as Vercel — used by notify scripts |
| `KV_REST_API_TOKEN` | Same as Vercel — used by notify scripts |
| `APP_URL` | Same as Vercel — notification deep-link URL |

### Generating VAPID Keys

```bash
npx web-push generate-vapid-keys
```

Copy the output into both Vercel env vars and GitHub secrets. The public key must also be hardcoded in `index.html` (search for `VAPID_PUBLIC_KEY` — there is one inline occurrence in the push registration snippet at the top of the file).

---

## Local Development

No build step for the frontend — open `index.html` directly or use a local server:

```bash
python3 -m http.server 7890
# open http://localhost:7890
```

For API routes (push notifications, recaps, ESPN proxy) use the Vercel CLI:

```bash
npm install
vercel dev          # serves both static files and /api/* serverless functions
```

Create a `.env` file in the repo root for local API testing:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
KV_REST_API_URL=https://...upstash.io
KV_REST_API_TOKEN=...
APP_URL=http://localhost:3000
GEMINI_API_KEY=...
```

To run the AI pipeline locally:

```bash
npm run pipeline:generate -- --date=2026-06-29         # generate recap for a specific date
npm run pipeline:generate -- --date=2026-06-29 --force  # skip readiness checks
```

---

## Deployment

Deployed on Vercel. Every push to `main` triggers an automatic deploy.

```bash
git clone https://github.com/bhaisbhai/worldcup2026.git
cd worldcup2026
# make changes to index.html
git add index.html
git commit -m "description of change"
git push origin main   # Vercel deploys automatically within ~30s
```

Routing is defined in `vercel.json`. The `index.html` catch-all at the end means all unknown paths serve the SPA:

```json
{ "src": "/(.*)", "dest": "/index.html" }
```

**`api/package.json`** exists separately from the root `package.json` to force CommonJS module resolution for Vercel serverless functions. Do not delete it.

---

## Data Flow

### Live match data (real-time)

```
Browser → /api/scoreboard → ESPN public API → parsed in browser → rendered
```

The browser polls every 30 seconds. Live matches poll faster via a 1-second `tick()` interval that interpolates the clock (no extra API call). When `refreshIn` hits zero, `fetchMatches()` re-fetches.

### AI content (nightly batch)

```
GitHub Actions (04–12 UTC)
  → ESPN API (yesterday's scores)
  → Gemini 2.0 Flash (recap + stakes text)
  → writes data/recaps.json + data/stakes.json
  → git commit [skip ci]
  → git push → Vercel deploy
  → Web Push notification sent to subscribers
```

### Push subscriptions

```
Browser subscribes → POST /api/subscribe → Upstash Redis (TTL 400 days)
GitHub Actions      → reads Redis → sends Web Push per subscriber
```

---

## ESPN API

All match data comes from ESPN's undocumented but stable public API. No API key required.

| Endpoint | Used for |
|---|---|
| `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard` | Today's matches (also accepts `?dates=YYYYMMDD`) |
| `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=<id>` | Match detail (odds, lineups, stats, play-by-play) |
| `https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings` | Group standings |
| `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/statistics` | Player/team stats |

The Vercel API routes proxy these calls (avoids CORS and adds caching headers). In `index.html`, all fetches go to `/api/scoreboard` etc., not directly to ESPN.

**Key ESPN data fields used:**

- `ev.competitions[0].status.type.state` → `"pre"` / `"in"` / `"post"`
- `ev.competitions[0].competitors[].team.abbreviation` → ESPN team abbr (ENG, FRA, etc.)
- `ev.competitions[0].broadcasts[].names[]` → broadcaster names (ignored — we use UK_TV lookup instead)
- `ev.competitions[0].status.displayClock` → live match clock string e.g. `"67'"`
- `ev.competitions[0].venue.fullName` / `.address.city`

---

## AI Pipeline (Gemini)

**Model:** `gemini-2.0-flash` — do NOT use `gemini-3.5-flash` (does not exist, returns 404).

**Main script:** `scripts/generate-ai-content.ts`

Runs nightly via GitHub Actions. Self-gates: if both recap and stakes for the target date already exist in `data/recaps.json` and `data/stakes.json`, it exits early without calling Gemini (saves quota and avoids duplicate entries).

**What it generates:**

1. **Recap** (`data/recaps.json`) — pundit-style match report for each completed game. Schema: `{date, headline, body, matches: [{homeTeam, awayTeam, score, recap}]}`.

2. **Stakes** (`data/stakes.json`) — pre-match "what's at stake" blurb for upcoming games. Schema: `{matchId, homeTeam, awayTeam, text}`.

**Readiness check:** the script waits until all matches scheduled for `targetDate` are in `"post"` state before generating recaps. It checks ESPN's scoreboard. If games are still live or incomplete, it exits — the next hourly cron run will retry.

**File paths in scripts:** all use `path.resolve(__dirname, '..', ...)` — NOT hardcoded Mac paths. Do not revert to absolute paths.

**Running a manual backfill:**

```bash
# Regenerate recap for a specific past date
npm run pipeline:generate -- --date=2026-06-15 --force

# Backfill a range (retrospective scripts)
npm run pipeline:retrospective-days
```

---

## GitHub Actions Workflows

### `overnight-ai-sync.yml` — Nightly recap generation

- **Schedule:** every hour 04:00–12:00 UTC (9 cron entries). Extended window because GitHub Actions cron is often 2–3 hours late.
- **Trigger:** also `workflow_dispatch` with optional `date` and `force` inputs.
- **What it does:** runs `npm run pipeline:generate`, commits if changed, sends recap push notification.
- **Env secrets needed:** `GEMINI_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `APP_URL`.

### `morning-digest.yml` — Daily fixture notification

- **Schedule:** `0 7 * * *` UTC (8:00 BST / 3:00 ET).
- **What it does:** sends a push notification listing today's fixtures.
- **Env secrets needed:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `APP_URL`.

### `player-clubs-sync.yml` / `player-stats-sync.yml`

- Periodic refresh of `data/player-clubs.json` and `data/player-stats.json`.
- Run `npm run pipeline:clubs` / `npm run pipeline:stats`.

### `send-recap-notification.yml`

- Manual `workflow_dispatch` only — sends a recap push immediately.

---

## Push Notifications

Uses the [Web Push Protocol](https://web.dev/push-notifications-overview/) with VAPID authentication.

**Subscription flow:**
1. Browser registers `sw.js` as a service worker.
2. User grants notification permission via the banner in `index.html`.
3. Browser calls `pushManager.subscribe()` with the VAPID public key.
4. Subscription object POSTed to `/api/subscribe`.
5. `api/subscribe.js` stores it in Upstash Redis with a 400-day TTL.

**Sending notifications:**
- `scripts/send-notifications.ts --type=digest` → today's fixtures summary.
- `scripts/send-notifications.ts --type=recap` → recap ready alert.
- Both read all subscriptions from Redis and call `web-push.sendNotification()` per subscriber.
- Stale subscriptions (410 Gone) are automatically deleted from Redis.

**Service worker (`sw.js`):** handles `push` events and shows native OS notifications. On click, opens `APP_URL`.

**VAPID public key** is hardcoded in `index.html` near the top (search for `VAPID_PUBLIC_KEY`). If you rotate keys, update it there too and redeploy.

---

## API Routes (Vercel Serverless)

All in `api/`. Functions are CommonJS (`require` / `module.exports`) — the `api/package.json` forces this scope. Do NOT change functions to ESM.

| Route | File | Notes |
|---|---|---|
| `GET /api/scoreboard[?dates=YYYYMMDD]` | `scoreboard.js` | Proxies ESPN scoreboard |
| `GET /api/summary?event=<id>` | `summary.js` | Match detail |
| `GET /api/statistics?event=<id>` | `statistics.js` | Match stats |
| `GET /api/standings` | `standings.js` | Group tables |
| `GET /api/recaps` | `recaps.js` | Serves `data/recaps.json` (CDN cached 5 min) |
| `GET /api/highlights?event=<id>` | `highlights.js` | Highlight video lookup |
| `GET /api/leaders` | `leaders.js` | Top scorers / assists |
| `GET /api/playerstats` | `playerstats.js` | Player stats |
| `GET /api/game-scores` | `game-scores.js` | Lightweight score poll |
| `GET /api/health` | `health.js` | Returns `{ok:true}` |
| `POST /api/subscribe` | `subscribe.js` | Save push subscription |
| `DELETE /api/subscribe` | `subscribe.js` | Remove push subscription |
| `POST /api/test-push` | `test-push.js` | Manual push test |

---

## UK TV Channel Data

All 104 matches are free-to-air on BBC and ITV. Channel assignments live in `index.html` as a JS object `UK_TV`, keyed by **sorted** ESPN abbreviation pairs:

```js
const UK_TV = {
  'COD|ENG': 'BBC One',   // England v DR Congo
  'BEL|SEN': 'ITV1',      // Belgium v Senegal
  // ...
};
function getUKChannel(a1, a2) {
  return UK_TV[[a1, a2].sort().join('|')] || '';
}
```

- Keys are always **alphabetically sorted** (e.g. `COD|ENG` not `ENG|COD`).
- If a match is not in the map, the function returns `''` — the UI shows nothing.
- Do NOT use `'BBC/ITV'` as a fallback — it's misleading.
- ESPN abbreviations: `ENG`, `FRA`, `BRA`, `ARG`, `USA`, `GER`, `ESP`, `POR`, `NED`, `BEL`, `CRO`, `SEN`, `MAR`, `AUS`, `JPN`, `SUI`, `ECU`, `COL`, `MEX`, `NOR`, `SWE`, `GHA`, `CPV`, `COD`, `BIH`, `CIV`, `AUT`, `EGY`, `PAR`, `ALG`, `SCO`, `HAI`, `QAT`, `RSA`, `CZE`, `KOR`, `TUR`, `JOR`, `UZB`, `PAN`, `IRN`, `NZL`, `IRQ`, `TUN`, `CUW`, `KSA`, `URU`, `CAN`, `RSA`.
- Cross-reference with the `FLAGS` object near the top of `index.html` if unsure of an abbreviation.

### Broadcast schedule by round

#### Group stage (June 11–27) — already in UK_TV

Full list embedded in the object. 52 confirmed matches.

#### Round of 32 (June 29–July 4) — already in UK_TV

| Date | Match | Channel |
|---|---|---|
| Mon 29 Jun | Brazil v Japan | ITV1 |
| Mon 29 Jun | Germany v Paraguay | BBC One |
| Tue 30 Jun | Netherlands v Morocco | ITV1 |
| Tue 30 Jun | Ivory Coast v Norway | BBC One |
| Tue 30 Jun | France v Sweden | ITV1 |
| Wed 1 Jul | Mexico v Ecuador | ITV1 |
| Wed 1 Jul | England v DR Congo | BBC One |
| Wed 1 Jul | Belgium v Senegal | ITV1 |
| Thu 2 Jul | USA v Bosnia-Herzegovina | BBC One |
| Thu 3 Jul | Spain v Austria | BBC One |
| Fri 4 Jul | Portugal v Croatia | BBC One |
| Fri 4 Jul | Switzerland v Algeria | BBC One |
| Fri 4 Jul | Australia v Egypt | BBC One |
| Fri 4 Jul | Argentina v Cape Verde | ITV1 |
| Sat 5 Jul | Colombia v Ghana | ITV1 |

#### Round of 16 (July 5–8) — to be added after R32 concludes

A scheduled agent runs on **July 5, 2026 at 08:00 BST**. It fetches the R16 schedule from [live-footballontv.com](https://www.live-footballontv.com/live-world-cup-football-on-tv.html), adds a `// Round of 16` block to `UK_TV`, updates this README table, and pushes to main.

#### Adding channels for a new round (manual process)

1. Clone the repo.
2. Open `index.html`, find the `UK_TV` object.
3. Add entries under a new `// Round of X` comment, using sorted abbreviation pairs.
4. Source: [live-footballontv.com](https://www.live-footballontv.com/live-world-cup-football-on-tv.html) or [sportsmole.co.uk](https://www.sportsmole.co.uk/football/england/world-cup/feature/world-cup-tv-schedule-where-to-watch-every-game-in-the-uk_596524.html).
5. Also update the table in this README.
6. Commit and push to main.

---

## Frontend Architecture

`index.html` is ~3 500 lines of vanilla HTML, CSS, and JavaScript. No framework, no bundler output.

### Key functions

| Function | What it does |
|---|---|
| `fetchMatches()` | Fetches `/api/scoreboard`, parses events, calls `renderToday()` |
| `renderToday(events, label, isPatch)` | Full or patch render of match cards |
| `buildCard(ev)` | Builds a match card DOM element |
| `patchCard(card, ev)` | Updates an existing card in place (avoids full re-render during live games) |
| `tick()` | Runs every second — updates live clocks, countdown timers, triggers refresh |
| `openMatchModal(ev)` | Opens the match detail modal, fetches summary data |
| `getUKChannel(a1, a2)` | Looks up UK broadcast channel from `UK_TV` object |
| `countdown(dateObj)` | Returns countdown string e.g. `"2h 30m 15s"` or `"Starting…"` |
| `localTime(dateObj)` | Returns local kick-off time string e.g. `"8:00 pm"` |
| `flag(abbr)` | Returns emoji flag for an ESPN team abbreviation |
| `getBBCCatalog()` | Fetches BBC Sport YouTube uploads playlist (highlights) |

### Card states

- **Upcoming (`pre`):** redesigned card with `mc-up-*` classes. Shows kick-off time and venue. No countdown timer (removed as noise).
- **Live (`in`):** shows `● Live` badge, live match clock, score.
- **Finished (`post`):** shows `FT` badge, score, goalscorers, BBC highlight clip.

### Refresh cycle

- `refreshIn` counts down from 30 each second.
- At zero, `fetchMatches()` fires and resets to 30.
- If `isPatch` is true (cards already exist, no skeleton), `patchCard()` updates in place — prevents flicker during live games.

---

## Static Data Files

### `data/recaps.json`

Array of daily recap objects. Updated nightly by the AI pipeline.

```json
[
  {
    "date": "2026-06-29",
    "headline": "Brazil cruise past Japan in opening R32 thriller",
    "body": "...",
    "matches": [
      { "homeTeam": "Brazil", "awayTeam": "Japan", "score": "3-1", "recap": "..." }
    ]
  }
]
```

### `data/stakes.json`

Pre-match "what's at stake" blurbs keyed by ESPN event ID.

```json
{ "12345": { "homeTeam": "England", "awayTeam": "DR Congo", "text": "..." } }
```

### `data/player-clubs.json`

Maps ESPN player IDs to club names and logos. Used in the lineups tab.

### `data/player-stats.json`

Tournament-level stats per player (goals, assists, minutes).

### `public/assets/ai/ai_master.json`

Canonical AI database — the source of truth for all generated content. The pipeline reads and writes this file. `data/*.json` files are derived exports from it.

---

## Scripts

Run with `tsx` (already in devDependencies). All paths use `__dirname`-relative resolution — do not hardcode Mac absolute paths.

```bash
npm run pipeline:generate                         # nightly recap + stakes
npm run pipeline:generate -- --date=2026-06-15   # specific date
npm run pipeline:generate -- --force             # skip readiness checks
npm run pipeline:retrospective-days              # backfill past day recaps
npm run pipeline:clubs                           # refresh player club data
npm run pipeline:stats                           # refresh player stats
npm run notify:digest                            # send fixture digest push
npm run notify:recap                             # send recap ready push
```

---

## Known Gotchas

1. **`gemini-3.5-flash` does not exist.** The correct model is `gemini-2.0-flash`. Using the wrong name returns a 404 from the API.

2. **GitHub Actions cron is often 2–3 hours late.** The overnight workflow runs every hour from 04:00–12:00 UTC specifically to absorb this delay. Do not reduce the window.

3. **`api/package.json` is required.** It forces CommonJS resolution for Vercel serverless functions. Deleting it breaks all `/api/*` routes.

4. **VAPID public key is hardcoded in `index.html`.** If you rotate keys, update the inline constant near the top of the file (search `VAPID_PUBLIC_KEY`) and also update Vercel env vars and GitHub secrets.

5. **ESPN timezone vs local timezone.** ESPN returns UTC timestamps. The app converts to local time with `dateObj.toLocaleTimeString()`. When browsing past dates with `?dates=YYYYMMDD`, use `localDateStr()` not `toISOString().slice(0,10)` — they differ around midnight.

6. **`data/recaps.json` is the bridge between the pipeline and the UI.** `api/recaps.js` serves this file directly. If recaps aren't appearing in the app, check that the pipeline is writing to `data/recaps.json` (not just `ai_master.json`).

7. **Upcoming cards use `mc-up-*` classes, not `mc-*`.** `patchCard()` uses `card.querySelector('.mc-min,.mc-ft-time,.mc-cd,.mc-kickoff')` to find the footer element. For upcoming cards this returns null — that is intentional; when a game goes live, the card is typically fully re-rendered rather than patched.

8. **BBC highlight matching is fuzzy.** `hlScore()` compares video titles from the BBC Sport YouTube playlist against ESPN team names using alias lists. If highlights are missing, check the alias map in `index.html` (search `BBC_ALIASES`).

9. **Android push notifications: permission must be requested before any `await`.** `Notification.requestPermission()` must be called synchronously (as the first `await`) inside a user-gesture handler. If *any* `await` (e.g. `serviceWorker.register()`) precedes it, Android Chrome loses the user-gesture context and silently ignores or blocks the permission prompt. The correct order in `subscribe()` is: request permission → register SW → `serviceWorker.ready` → `pushManager.subscribe()` → POST to `/api/subscribe`.

10. **`KO_DATA` in `index.html` is hardcoded and must be updated manually.** It contains the full knockout bracket structure (match numbers, teams, stadiums, cities, dates) for all 64 knockout matches. Dates are display strings like `'Jul 6'` — they do not auto-update from ESPN. If bracket dates appear wrong, cross-reference against `data/stakes.json` (which contains actual match dates keyed by date string) and the official FIFA schedule. Confirmed 2026 WC knockout schedule: R32 Jun 28–Jul 4, R16 Jul 4–7, QF Jul 9–11, SF Jul 14–15, Final Jul 19.

---

## Changelog

### July 2026
- **Knockout bracket date corrections** — fixed all R32 dates (NED-MAR: Jun 29, MEX-ECU: Jun 30) and all R16 dates (left side Jul 4/5, right side Jul 6/7) in `KO_DATA` to match the official 2026 schedule
- **Qualified banner** — finished knockout match cards now show which team qualified and "(on penalties)" if the match went to a shootout (`mc-qualified` / `mc-pens` CSS classes; logic in `buildCard()`)
- **Android push notification fix** — moved `Notification.requestPermission()` to be the very first `await` in `subscribe()`, before `serviceWorker.register()`, to preserve user-gesture context on Android Chrome
- **R32 TV channels** — added all 15 Round of 32 UK broadcast channel assignments to `UK_TV`
- **Removed countdown timer** — `mc-up-cd` span removed from upcoming match cards; `countdown()` no longer returns `'Tomorrow'` under any condition
- **Channel fallback** — `getUKChannel` fallback changed from `'BBC/ITV'` to `''` so unconfirmed games show nothing
- **README** — full operational documentation added for agent handover

### June 2026
- Initial tournament launch
- Full group stage UK TV listings
- Live scores via ESPN public API
- AI recap pipeline (Gemini 2.0 Flash + GitHub Actions)
- BBC Sport highlight integration
- Web Push notifications (VAPID + Upstash Redis)
- Group standings table
- Knockout bracket (Round of 32 onward)
- Match detail modal (Overview, Stats, Lineups, Highlights, News tabs)
- Day navigation (browse any tournament date)
- Team pages (squad, form, stats)
