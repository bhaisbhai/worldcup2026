# Game Buddy — FIFA World Cup 2026: Technical Brief

**Site:** game-buddy.co.uk  
**Repo:** github.com/bhaisbhai/worldcup2026  
**Stack:** Vanilla JS SPA · Vercel (static + serverless) · ESPN public API · Gemini 2.0 Flash  
**Date written:** 2026-06-20

---

## 1. Architecture Overview

```
Browser
  └─ index.html (single-page app, no build step, vanilla JS)
       ├─ /api/* → Vercel serverless functions (Node 20) — ESPN proxy
       └─ /assets/ai/*.json → Vercel static files — pre-generated AI content
```

### Tabs
| Tab | Source |
|---|---|
| Today | ESPN scoreboard API (live, polled every 60s) |
| Groups | ESPN standings API |
| Stats | ESPN standings + `/api/playerstats` (server-side aggregator) |
| Rules | Static hardcoded content (FIFA WC 2026 laws) |

### Vercel config (`vercel.json`)
```json
{
  "version": 2,
  "builds": [
    { "src": "index.html", "use": "@vercel/static" },
    { "src": "assets/**", "use": "@vercel/static" },
    { "src": "api/**/*.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1.js" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```
The `{ "handle": "filesystem" }` entry is critical — without it the SPA catch-all intercepts `/assets/ai/*.json` and returns `index.html`.

### API proxy functions (`api/`)
| File | ESPN endpoint proxied |
|---|---|
| `scoreboard.js` | `/apis/site/v2/sports/soccer/fifa.world/scoreboard` |
| `standings.js` | `/apis/v2/sports/soccer/fifa.world/standings` |
| `summary.js` | `/apis/site/v2/sports/soccer/fifa.world/summary` |
| `playerstats.js` | Server-side aggregator: fetches all match summaries, parses goals/assists/cards from keyEvents |
| `health.js` | Returns `{ok:true}` for uptime checks |
| `_proxy.js` | Shared fetch helper with 8s timeout and Cache-Control headers |

---

## 2. Gen AI Integration — Overnight Pipeline

### Purpose
A GitHub Actions workflow runs nightly at **05:00 UTC** (06:00 BST). It:
1. Fetches yesterday's match data from ESPN
2. Calls **Gemini 2.0 Flash** to generate British-pundit-style commentary
3. Commits the resulting JSON files to `assets/ai/` on `main`
4. Vercel auto-deploys on push → static JSON served from CDN

### Files generated
| File | Content |
|---|---|
| `assets/ai/matches_ai.json` | Per-match banter summaries (editionTitle, snappySummary, talkingPoints, randomQuirk) |
| `assets/ai/teams_ai.json` | Per-team tournament narrative (headline, storySoFar, whatsNext, pubAmmo) |
| `assets/ai/players_ai.json` | Per-player verdicts for tracked top-50 list (verdict, roomForImprovement, whatsNext, quirkyTrivia) |
| `assets/ai/daily_recap.json` | Daily narrative for yesterday (headline, theDrama, mustWatchHighlights, progressionNews) |
| `assets/ai/today_preview.json` | Preview for today's upcoming matches (headline, theBigOnes, playersToWatch, firstKickoffTime) |

### Pipeline script: `scripts/generate-ai-content.js`

**Execution order:**
1. Fetch ESPN standings (all groups)
2. For each day being processed: fetch scoreboard, fetch match summaries in parallel
3. **Section 1 — Match summaries:** batch matches in groups of 5 (`BATCH_SIZE=5`), one Gemini call per batch
4. **Section 2 — Team statuses:** single Gemini call with all teams that played
5. **Section 3 — Player verdicts:** single Gemini call for top-50 players seen in key events
6. **Section 4 — Daily recap:** single Gemini call summarising yesterday
7. **Section 5 — Today's preview:** fetch today's upcoming fixtures, single Gemini call

**Gemini call details:**
- Model: `gemini-2.0-flash` (configurable via `GEMINI_MODEL` env var)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}`
- `responseMimeType: 'application/json'` with `responseSchema` enforcing strict JSON structure
- `temperature: 0.85`, `maxOutputTokens: 8192`
- Anti-hallucination persona enforced in system prompt — all commentary must cite specific data points from the input JSON

**Rate limiting strategy (current):**
- `BATCH_SIZE = 5` → at most 2 batches for a typical 8-match day
- Total Gemini calls in daily mode: **~6 calls**
- 6s sleep between every section (`await sleep(6000)`)
- At most ~6 RPM, well under the free-tier 15 RPM ceiling
- On 429 error: retry with `(attempt+1) × 20s` backoff (20s / 40s / 60s) to clear the 60-second RPM window
- Retries: 3 attempts per call

**Modes:**
- `node scripts/generate-ai-content.js` — daily mode, processes yesterday only
- `node scripts/generate-ai-content.js --retro` — retro mode, processes every day from tournament start (2026-06-11) to yesterday; 300ms delay between day fetches

### GitHub Actions workflow: `.github/workflows/overnight-ai-sync.yml`
```yaml
on:
  schedule:
    - cron: '0 5 * * *'   # 05:00 UTC daily
  workflow_dispatch:        # Manual trigger

jobs:
  generate-and-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4 with: node-version: '20'
      - name: Run AI Synthesis Pipeline
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: node scripts/generate-ai-content.js
      - name: Commit and Push AI Assets
        run: |
          git add assets/ai/*.json
          if ! git diff-index --quiet HEAD; then
            git commit -m "chore: automated overnight ai sports summary synchronization [skip ci]"
            git push origin main
          fi
```

**Security:** The Gemini API key is stored as a GitHub Secret (`GEMINI_API_KEY`). It is never hardcoded or committed.

### Frontend: "Pundit's Briefing" card (`index.html`)

Displayed at the top of the **Today** tab only when viewing the current date (not when browsing historical dates).

**Logic:**
- Before first kickoff of the day → show `today_preview.json` (badge: "Preview")
- After first kickoff → show `daily_recap.json` (badge: "Recap")
- If neither file has a `headline` field → card is hidden (graceful degradation)
- 5-minute client-side cache on the fetch responses
- XSS-safe: all Gemini output HTML-escaped via `esc()` before injection

**CSS class:** `.pb-card` — dark card with green gradient border matching the app's accent colour.

---

## 3. Problems Encountered & Current Status

### Problem 1 — Wrong API key format (Run 1)
The initial `GEMINI_API_KEY` secret was set to a key with an invalid format (did not start with `AIza`). All 6 Gemini calls returned 429.  
**Fix:** User replaced the secret with a valid Gemini REST API key.

### Problem 2 — 429 rate limit errors caused by burst retries (Runs 1 & 2)
**Root cause:** The original retry logic used 2s/4s backoff delays. When a 429 was returned, the script retried rapidly within the same 60-second RPM window:
- 6 Gemini calls × 4 attempts (1 original + 3 retries) = 24 API calls in ~30 seconds
- Effective rate: ~48 RPM → well above the 15 RPM free-tier limit
- This created a cascade: each retry made things worse

**Fix (applied in commit `3788640`):**
- 429 retry backoff changed from `(attempt+1) × 2000ms` to `(attempt+1) × 20000ms` (20s/40s/60s)
- Inter-section delays changed from 1000ms to 6000ms
- Retries increased from 2 to 3

### Problem 3 — Run 3 succeeded but generated empty content
Run 3 (`run_id: 27881431456`) completed successfully (19:24–19:33 UTC, 8.5 minutes) with status `conclusion: "success"`. A commit was pushed to main. However `today_preview.json` and `daily_recap.json` remain `{}`, and `matches_ai.json` / `teams_ai.json` have updated timestamps but empty data.

**Likely causes (under investigation):**
1. **No completed matches from yesterday:** ESPN may have returned June 19 matches with a status other than `'post'`. The pipeline filters `m.status === 'post'` — if matches were in `'in'` or another state, `allCompleted` would be empty, skipping all Gemini sections.
2. **Today's matches already in progress:** The pipeline ran at 19:25 UTC on June 20. Any matches that kicked off before then would be `'in'` or `'post'`, not `'pre'`, so the today-preview section would find `upcoming.length === 0` and skip.
3. **Gemini calls succeeded but returned empty arrays:** If Gemini returned a structurally valid but empty JSON response, `results || []` would produce an empty map. Errors are caught silently (logged, not thrown), so the pipeline exits cleanly.
4. **The pipeline always saves the timestamp** even with no new data, triggering a commit even when nothing was generated.

**Next investigative step:** Read the GitHub Actions job logs (job ID `82509573951`) to see the exact console output — specifically whether `[pipeline] XXXX-XX-XX: no completed matches` was printed, or whether Gemini errors appeared.

### Known limitations
- The pipeline can only generate a recap AFTER matches are completed. Running it mid-tournament-day means today's matches are still live.
- The `today_preview.json` `firstKickoffTime` field drives the Preview→Recap switch on the frontend — this field must be in ISO 8601 UTC format.
- Free-tier Gemini: 15 RPM, 1,500 RPD, 1,000,000 TPM. With current batch sizes the pipeline uses ~6 calls/run comfortably under all limits.

---

## 4. Frontend Feature Summary

### Today tab
- Live match cards with live scores, status, and countdown to kickoff
- Date navigation (browse any day in the tournament)
- **Pundit's Briefing card** (AI-generated, top of the tab)
- Groups highlighted if they have matches today (pulsing green dot)

### Groups tab
- All 12 groups with team standings (P/W/D/L/GF/GA/GD/Pts)
- Groups playing today are faintly highlighted in green

### Stats tab
- Team standings ranked by points across all groups
- Per-group breakdown table
- Player stats via `/api/playerstats` (server-side aggregator parsing ESPN match summaries)

### Rules tab
- FIFA WC 2026 laws with NEW/UPDATED/CORE badges
- Filter pills: All / New & Updated / VAR & Tech / Set Pieces / Player Conduct / Substitutions / Match Format / Tournament
- Accordion-style expandable cards

### Match modal
- Opens on any match card tap
- Live/pre/post states with score, flags, timeline
- Key events (goals, cards) from ESPN summary API

### PWA
- Installable (manifest.json, apple-touch-icon)
- iOS home screen title: "Game Buddy"

---

## 5. Repo Structure

```
worldcup2026/
├── index.html                    # Entire SPA (HTML + CSS + JS in one file)
├── vercel.json                   # Vercel config (static + serverless routes)
├── package.json                  # Pipeline scripts (pipeline:generate, pipeline:retro)
├── api/
│   ├── _proxy.js                 # Shared fetch helper
│   ├── scoreboard.js             # ESPN scoreboard proxy
│   ├── standings.js              # ESPN standings proxy
│   ├── summary.js                # ESPN match summary proxy
│   ├── playerstats.js            # Server-side player stats aggregator
│   └── health.js                 # Health check endpoint
├── scripts/
│   └── generate-ai-content.js   # Overnight Gemini pipeline
├── assets/
│   └── ai/
│       ├── matches_ai.json       # Per-match AI summaries
│       ├── teams_ai.json         # Per-team AI narratives
│       ├── players_ai.json       # Per-player AI verdicts
│       ├── daily_recap.json      # Yesterday's AI recap
│       └── today_preview.json    # Today's AI preview
└── .github/
    └── workflows/
        └── overnight-ai-sync.yml # Daily 05:00 UTC cron job
```

---

## 6. Environment Variables & Secrets

| Name | Where | Value |
|---|---|---|
| `GEMINI_API_KEY` | GitHub Secret | Gemini REST API key (starts `AIza…`) |
| `GEMINI_MODEL` | Optional env var | Default: `gemini-2.0-flash` |

No `.env` file exists. The secret is only injected into the GitHub Actions runner environment during the pipeline step.

---

## 7. Development Branch

Current feature branch: `claude/app-overview-l70sz7`  
All AI pipeline work merged to `main` (required for `workflow_dispatch` triggers).
