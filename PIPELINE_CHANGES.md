# Pipeline Changes — For Gemini Review

This document lists every change made to the AI generation pipeline during this session. The original scripts were written by Gemini and working locally on Mac. These changes were made to fix failures on GitHub Actions (Ubuntu). Gemini is asked to review and dispute any changes that are incorrect or unnecessary.

---

## 1. `scripts/generate-ai-content.ts`

### Change 1 — Model name

**Before:**
```typescript
model: "gemini-3.5-flash",
```

**After:**
```typescript
model: "gemini-2.0-flash",
```

**Reason:** `gemini-3.5-flash` does not exist as a valid model identifier in the `@google/genai` SDK. The API returned a 404/invalid model error. `gemini-2.0-flash` is the correct model that matches the one used in `generate-retrospective-days.ts`.

**Gemini — is this correct? Was `gemini-3.5-flash` intentional or a typo?**

---

### Change 2 — masterPath (hardcoded Mac path → portable relative path)

**Before:**
```typescript
const masterPath = '/Users/rajarjan/Documents/game buddy/public/assets/ai/ai_master.json';
```

**After:**
```typescript
const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
```

**Reason:** The Mac absolute path `/Users/rajarjan/...` does not exist on GitHub Actions (Ubuntu runner). `__dirname` in a `tsx`-compiled script resolves to the `scripts/` directory, so `..` goes to the repo root, then into `public/assets/ai/`.

**Gemini — is `path.resolve(__dirname, '..', ...)` the correct approach here, or did you intend a different resolution strategy?**

---

### Change 3 — csvDir (two occurrences, hardcoded Mac path → portable relative path)

**Before (both occurrences):**
```typescript
const csvDir = '/Users/rajarjan/Documents/game buddy/public/assets/ai/csv';
```

**After (both occurrences):**
```typescript
const csvDir = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'csv');
```

**Reason:** Same as Change 2 — Mac absolute path fails on GitHub Actions.

---

### Change 4 — Default target date (hardcoded → computed yesterday)

**Before:**
```typescript
if (!targetDate) {
  targetDate = '2026-06-20'; // or whatever was hardcoded
}
```

**After:**
```typescript
if (!targetDate) {
  // Default to yesterday — run after midnight so previous day's matches are complete
  const d = new Date();
  d.setDate(d.getDate() - 1);
  targetDate = d.toISOString().split('T')[0];
}
```

**Reason:** A hardcoded date only works once. The workflow runs at 08:00 UTC every morning. At that time, the previous day's matches are complete. Computing yesterday ensures the pipeline always processes the correct date without manual intervention.

**Gemini — did you intend for the date to be passed every time as `--date=YYYY-MM-DD` via CLI, making this fallback irrelevant? Or was the hardcoded date just left in during development?**

---

### Change 5 — Write recap to `data/recaps.json` (new code added)

**Before:** No such code existed. The daily recap from Gemini was saved only to `masterDB.days[targetDate]` and to `public/assets/ai/csv/days_ai.csv`.

**After:** After writing the day recap to master JSON and CSV, the script also writes to `data/recaps.json`:

```typescript
// Also update data/recaps.json (served via /api/recaps)
const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
let recaps: any[] = [];
if (fs.existsSync(recapsPath)) {
  try { recaps = JSON.parse(fs.readFileSync(recapsPath, 'utf-8')); } catch {}
}
const existingIdx = recaps.findIndex((r: any) => r.date === targetDate);
const recapEntry = { date: targetDate, ...response.day };
if (existingIdx !== -1) recaps[existingIdx] = recapEntry;
else recaps.push(recapEntry);
recaps.sort((a: any, b: any) => a.date.localeCompare(b.date));
fs.writeFileSync(recapsPath, JSON.stringify(recaps, null, 2), 'utf-8');
console.log(`🎉 data/recaps.json updated with ${targetDate} recap.`);
```

**Reason:** The front-end recap card (Today tab) fetches from `/api/recaps`, which is backed by `data/recaps.json`. Without this step, the recap card would never update even if the pipeline ran successfully. `data/recaps.json` is the bridge between the AI pipeline and the live UI.

**Gemini — this is a new responsibility added to this script. Is there a reason you didn't wire `data/recaps.json` updates here originally, or did you expect a separate step to handle it?**

---

## 2. `scripts/generate-retrospective-days.ts`

### Change 1 — Model name

**Before:**
```typescript
model: "gemini-3.5-flash",
```

**After:**
```typescript
model: "gemini-2.0-flash",
```

**Reason:** Same as `generate-ai-content.ts` Change 1.

---

### Change 2 — masterPath (hardcoded Mac path → portable relative path)

**Before:**
```typescript
const masterPath = '/Users/rajarjan/Documents/game buddy/public/assets/ai/ai_master.json';
```

**After:**
```typescript
const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
```

**Reason:** Same as `generate-ai-content.ts` Change 2.

---

### Change 3 — csvPath (hardcoded Mac path → portable relative path)

**Before:**
```typescript
const csvPath = '/Users/rajarjan/Documents/game buddy/public/assets/ai/csv/days_ai.csv';
```

**After:**
```typescript
const csvPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'csv', 'days_ai.csv');
```

**Reason:** Same as `generate-ai-content.ts` Change 2.

---

## 3. `.github/workflows/overnight-ai-sync.yml`

### Change 1 — Removed unused environment variable

**Before:**
```yaml
- name: Run AI Pipeline
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    SPORTS_DATA_API_KEY: ${{ secrets.SPORTS_DATA_API_KEY }}
  run: npm run pipeline:generate
```

**After:**
```yaml
- name: Run AI Pipeline
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  run: npm run pipeline:generate
```

**Reason:** `SPORTS_DATA_API_KEY` is not referenced anywhere in `generate-ai-content.ts`. The script fetches data exclusively from the public ESPN API (no auth required). Leaving it in is harmless, but it was removed to avoid confusion about whether the secret needs to be configured.

**Gemini — was `SPORTS_DATA_API_KEY` used in a previous version of the script, or planned for a future data source?**

---

### Change 2 — Added `data/recaps.json` to the commit step

**Before:**
```yaml
git add data/recaps.json public/assets/ai/ai_master.json public/assets/ai/csv/
```

Wait — actually the original workflow already had this line. The file `data/recaps.json` was already in the `git add` command. Confirmed: no change needed here, the commit step was already correct.

---

## Summary Table

| File | Change | Type |
|------|--------|------|
| `generate-ai-content.ts` | `gemini-3.5-flash` → `gemini-2.0-flash` | Bug fix |
| `generate-ai-content.ts` | Mac absolute path → `__dirname`-relative (masterPath) | Portability fix |
| `generate-ai-content.ts` | Mac absolute path → `__dirname`-relative (csvDir, ×2) | Portability fix |
| `generate-ai-content.ts` | Hardcoded date → compute yesterday | Logic fix |
| `generate-ai-content.ts` | Write `data/recaps.json` after day recap | New feature |
| `generate-retrospective-days.ts` | `gemini-3.5-flash` → `gemini-2.0-flash` | Bug fix |
| `generate-retrospective-days.ts` | Mac absolute path → `__dirname`-relative (masterPath) | Portability fix |
| `generate-retrospective-days.ts` | Mac absolute path → `__dirname`-relative (csvPath) | Portability fix |
| `overnight-ai-sync.yml` | Removed `SPORTS_DATA_API_KEY` from env | Cleanup |

---

## What Was NOT Changed

- The Gemini API call structure, schema definitions, retry logic, and backoff timers — unchanged.
- The ESPN API endpoints and data parsing logic — unchanged.
- The CSV helper functions (`parseCSV`, `stringifyCSVRow`, `updateCSVFile`) — unchanged.
- The `punditSystemInstruction` system prompt — unchanged.
- The `pipeline:generate` npm script definition — unchanged.
- The workflow trigger (`0 8 * * *` UTC), permissions, and Node.js setup — unchanged.
