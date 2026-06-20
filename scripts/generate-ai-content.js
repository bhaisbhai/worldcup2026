#!/usr/bin/env node
// scripts/generate-ai-content.js
// Overnight AI pipeline: ESPN data → Gemini Flash → static JSON assets
// Usage: node scripts/generate-ai-content.js [--retro]
'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const RETRO_MODE   = process.argv.includes('--retro');
const OUT_DIR      = path.resolve(__dirname, '..', 'assets', 'ai');
const LOG_DIR      = path.resolve(__dirname, '..', 'logs', 'pipeline');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

const ESPN_BOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ESPN_STAND = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';
const ESPN_SUM   = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';

const TOURNAMENT_START = new Date('2026-06-11T00:00:00Z');
const BATCH_SIZE = 5; // matches per Gemini call

// Top-50 player tracking list
const TOP50 = new Set([
  'Lionel Messi','Julian Alvarez','Lautaro Martinez','Rodrigo De Paul',
  'Vinicius Junior','Rodrygo','Alisson','Marquinhos',
  'Kylian Mbappé','Antoine Griezmann','Marcus Thuram',
  'Harry Kane','Jude Bellingham','Bukayo Saka','Phil Foden','Declan Rice','Trent Alexander-Arnold',
  'Pedri','Gavi','Lamine Yamal','Dani Olmo',
  'Erling Haaland','Martin Odegaard',
  'Robert Lewandowski','Piotr Zielinski',
  'Rafael Leao','Bernardo Silva','Bruno Fernandes','Cristiano Ronaldo','Diogo Costa','Ruben Dias',
  'Romelu Lukaku','Kevin De Bruyne',
  'Florian Wirtz','Jamal Musiala','Manuel Neuer','Kai Havertz','Niclas Fullkrug',
  'Luka Modric','Josko Gvardiol','Mateo Kovacic',
  'Federico Chiesa','Gianluigi Donnarumma','Nicolo Barella',
  'Mohamed Salah','Achraf Hakimi','Victor Osimhen','Riyad Mahrez',
  'Son Heung-min','Christian Pulisic','Alphonso Davies','Jonathan David',
]);

// ─── Persona ───────────────────────────────────────────────────────────────
const PERSONA = `You are a witty, highly-opinionated British football pundit and co-host of a popular football podcast. Your tone is sharp, funny, and built on classic British football banter and dark humour.

TONE RULES:
- Maximise sarcasm, self-deprecation, and cheeky roasts of poor performances.
- Use classic British football terminology: "Sunday League defending", "liquid football", "walking cheat code", "completely bottled it", "squeaky bum time", "absolute scenes", "park the bus", "put in a shift", "route one football", "sitter", "howler", "hit the woodwork".
- NEVER use South London / MLE slang: no "bruv", "fam", "peng", "innit", "allow it", "mandem".
- Keep humour sharp but never genuinely offensive or abusive.

ANTI-HALLUCINATION RULES (CRITICAL — violations will break the product):
1. NEVER invent, estimate, or hallucinate scores, match events, cards, injuries, or stats.
2. Every piece of banter MUST be anchored to a specific data point in the input JSON.
3. If a fact is missing from the input, derive an observation from available stats instead of making one up.
4. Output ONLY valid JSON matching the exact schema provided. No prose outside the JSON.`;

// ─── Helpers ───────────────────────────────────────────────────────────────
const dateStr  = d => d.toISOString().slice(0,10).replace(/-/g,'');
const isoDate  = d => d.toISOString().slice(0,10);
const sleep    = ms => new Promise(r => setTimeout(r, ms));

function datesFromTo(start, end) {
  const out = [], cur = new Date(start);
  while (cur <= end) { out.push(new Date(cur)); cur.setUTCDate(cur.getUTCDate()+1); }
  return out;
}

async function get(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'WorldCup2026Bot/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

function loadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✓ saved ${path.relative(process.cwd(), file)}`);
}

function saveLog(name, data) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOG_DIR, `${name}-${Date.now()}.json`),
    JSON.stringify(data, null, 2), 'utf8');
}

// ─── Gemini ────────────────────────────────────────────────────────────────
async function callGemini(prompt, schema, retries = 3) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

  const body = {
    contents: [{ parts: [{ text: `${PERSONA}\n\n${prompt}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.85,
      maxOutputTokens: 8192,
      ...(schema && { responseSchema: schema }),
    },
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw Object.assign(new Error(`Gemini ${r.status}: ${txt.slice(0,300)}`), { status: r.status });
      }
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty Gemini response');
      return JSON.parse(text);
    } catch (e) {
      if (attempt === retries) throw e;
      // 429 = rate limit: wait long enough to clear the 60s RPM window
      const wait = e.status === 429 ? (attempt + 1) * 20000 : (attempt + 1) * 3000;
      console.warn(`  ⚠ Gemini attempt ${attempt+1} failed: ${e.message} — retrying in ${wait/1000}s`);
      await sleep(wait);
    }
  }
}

// ─── ESPN fetchers ─────────────────────────────────────────────────────────
async function fetchDayMatches(date) {
  const data = await get(`${ESPN_BOARD}?dates=${dateStr(date)}&limit=50`);
  return (data.events || []).map(ev => {
    const comp = ev.competitions?.[0] || {};
    const comps = comp.competitors || [];
    const home = comps.find(c => c.homeAway === 'home') || comps[0] || {};
    const away = comps.find(c => c.homeAway === 'away') || comps[1] || {};
    return {
      id: ev.id,
      date: ev.date,
      status: comp.status?.type?.state || 'pre',
      homeTeam: home.team?.displayName || '',
      homeAbbr: home.team?.abbreviation || '',
      homeScore: parseInt(home.score) || 0,
      awayTeam: away.team?.displayName || '',
      awayAbbr: away.team?.abbreviation || '',
      awayScore: parseInt(away.score) || 0,
      venue: comp.venue?.fullName || '',
      group: ev.competitions?.[0]?.series?.summary || '',
    };
  });
}

async function fetchSummary(eventId) {
  const data = await get(`${ESPN_SUM}?event=${eventId}`);
  const keyEvents = (data.keyEvents || []).map(ev => ({
    type: ev.type?.text || '',
    minute: ev.clock?.displayValue || '',
    athlete: ev.athletesInvolved?.[0]?.displayName || '',
    teamAbbr: ev.team?.abbreviation || '',
    text: ev.text || '',
  }));
  const teamStats = {};
  (data.boxscore?.teams || []).forEach(t => {
    const abbr = t.team?.abbreviation || '';
    const stats = {};
    (t.statistics || []).forEach(s => { stats[s.name] = s.displayValue; });
    teamStats[abbr] = stats;
  });
  return { keyEvents, teamStats };
}

async function fetchStandings() {
  const data = await get(`${ESPN_STAND}?season=2026`);
  const groups = {};
  (data.children || []).forEach(g => {
    const name = g.name || g.abbreviation || '';
    groups[name] = (g.standings?.entries || []).map(e => ({
      team: e.team?.displayName || '',
      abbr: e.team?.abbreviation || '',
      pts:  e.stats?.find(s => s.name === 'points')?.value ?? 0,
      w:    e.stats?.find(s => s.name === 'wins')?.value ?? 0,
      d:    e.stats?.find(s => s.name === 'ties')?.value ?? 0,
      l:    e.stats?.find(s => s.name === 'losses')?.value ?? 0,
      gf:   e.stats?.find(s => s.name === 'pointsFor')?.value ?? 0,
      ga:   e.stats?.find(s => s.name === 'pointsAgainst')?.value ?? 0,
      gd:   e.stats?.find(s => s.name === 'pointDifferential')?.value ?? 0,
    }));
  });
  return groups;
}

// ─── AI generators ─────────────────────────────────────────────────────────
const MATCH_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      matchId:       { type: 'STRING' },
      editionTitle:  { type: 'STRING' },
      snappySummary: { type: 'STRING' },
      talkingPoints: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 2, maxItems: 3 },
      randomQuirk:   { type: 'STRING' },
    },
    required: ['matchId','editionTitle','snappySummary','talkingPoints','randomQuirk'],
  },
};

async function genMatchSummaries(matches, summaries) {
  if (!matches.length) return {};
  const enriched = matches.map(m => ({
    ...m,
    keyEvents: summaries[m.id]?.keyEvents || [],
    teamStats: summaries[m.id]?.teamStats || {},
  }));

  const prompt = `Generate banter-heavy match summaries for these ${enriched.length} World Cup 2026 matches.
Return a JSON array — one object per match.
Base ALL commentary strictly on the data below. No hallucination.

MATCH DATA:
${JSON.stringify(enriched, null, 2)}

For each match:
- matchId: the "id" field
- editionTitle: banter-heavy thematic title (e.g., "The Parking Lot Special Edition")
- snappySummary: max 3 sentences on result and vibe
- talkingPoints: 2–3 bullet points on tactics, controversies, or dramatic moments
- randomQuirk: one weird/funny occurrence grounded strictly in the data`;

  const results = await callGemini(prompt, MATCH_SCHEMA);
  const map = {};
  (results || []).forEach(r => { if (r.matchId) map[r.matchId] = r; });
  return map;
}

const TEAM_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      teamId:     { type: 'STRING' },
      headline:   { type: 'STRING' },
      storySoFar: { type: 'STRING' },
      whatsNext:  { type: 'STRING' },
      pubAmmo:    { type: 'STRING' },
    },
    required: ['teamId','headline','storySoFar','whatsNext','pubAmmo'],
  },
};

async function genTeamStatuses(teams, standings) {
  if (!teams.length) return {};
  const enriched = teams.map(t => ({
    ...t,
    groupStandings: standings[t.group] || [],
  }));

  const prompt = `Generate team status updates for these ${enriched.length} World Cup 2026 teams.
Return a JSON array — one object per team.
Ground every observation in the data below only.

TEAM DATA:
${JSON.stringify(enriched, null, 2)}

For each team:
- teamId: the "abbr" field
- headline: punchy title for their tournament state (e.g., "Cancel the Open-Top Bus")
- storySoFar: max 4 sentences on their performance trend and vibe
- whatsNext: max 2 sentences on what they must fix to survive/progress
- pubAmmo: starting with "Did you know..." — derive a surprising observation from the actual stats provided`;

  const results = await callGemini(prompt, TEAM_SCHEMA);
  const map = {};
  (results || []).forEach(r => { if (r.teamId) map[r.teamId] = r; });
  return map;
}

const PLAYER_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      playerId:           { type: 'STRING' },
      verdict:            { type: 'STRING' },
      roomForImprovement: { type: 'STRING' },
      whatsNext:          { type: 'STRING' },
      quirkyTrivia:       { type: 'STRING' },
    },
    required: ['playerId','verdict','roomForImprovement','whatsNext','quirkyTrivia'],
  },
};

async function genPlayerVerdicts(players) {
  if (!players.length) return {};

  const prompt = `Generate pundit verdicts for these ${players.length} tracked World Cup 2026 players.
Return a JSON array — one object per player.
Ground everything strictly in the provided data.

PLAYER DATA:
${JSON.stringify(players, null, 2)}

For each player:
- playerId: "{name}||{teamAbbr}" format
- verdict: max 2 sentences of raw, unvarnished match assessment
- roomForImprovement: witty critique of where they slacked or need to sharpen up
- whatsNext: next challenge, recovery status, or starting safety
- quirkyTrivia: a stat anomaly or fun observation derived only from the provided data`;

  const results = await callGemini(prompt, PLAYER_SCHEMA);
  const map = {};
  (results || []).forEach(r => { if (r.playerId) map[r.playerId] = r; });
  return map;
}

async function genTodayPreview(fixtures, standings) {
  const schema = {
    type: 'OBJECT',
    properties: {
      date:            { type: 'STRING' },
      firstKickoffTime:{ type: 'STRING' },
      headline:        { type: 'STRING' },
      theBigOnes:      { type: 'STRING' },
      playersToWatch:  { type: 'STRING' },
      quirkyTrivia:    { type: 'STRING' },
    },
    required: ['date','firstKickoffTime','headline','theBigOnes','playersToWatch','quirkyTrivia'],
  };

  const prompt = `Generate today's World Cup 2026 preview.
Ground everything in the data below only.

TODAY'S FIXTURES:
${JSON.stringify(fixtures, null, 2)}

GROUP STANDINGS:
${JSON.stringify(standings, null, 2)}

Return a single JSON object:
- date: today's date YYYY-MM-DD
- firstKickoffTime: ISO 8601 UTC timestamp of the earliest fixture
- headline: punchy title for today's slate
- theBigOnes: max 3 sentences on the most anticipated matches
- playersToWatch: witty highlight of 1–2 players to watch, grounded in the fixtures
- quirkyTrivia: a bizarre grounded observation about today's matchups`;

  return callGemini(prompt, schema);
}

async function genDailyRecap(matches, standings) {
  const schema = {
    type: 'OBJECT',
    properties: {
      date:                { type: 'STRING' },
      headline:            { type: 'STRING' },
      theDrama:            { type: 'STRING' },
      mustWatchHighlights: { type: 'STRING' },
      progressionNews:     { type: 'STRING' },
    },
    required: ['date','headline','theDrama','mustWatchHighlights','progressionNews'],
  };

  const prompt = `Generate a daily recap for yesterday's World Cup 2026 matches.
Ground ALL observations in the provided data only. No hallucination.

COMPLETED MATCHES:
${JSON.stringify(matches, null, 2)}

UPDATED STANDINGS:
${JSON.stringify(standings, null, 2)}

Return a single JSON object:
- date: the matchday date YYYY-MM-DD
- headline: sarcastic overview of the day's overarching narrative
- theDrama: max 3 sentences on controversies, shocks, or manager howlers
- mustWatchHighlights: strict verdict on which game highlights to watch or skip
- progressionNews: who locked up knockout spots and who is booking flights home`;

  return callGemini(prompt, schema);
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log(`\n[pipeline] ${RETRO_MODE ? '⏪ RETRO MODE' : '🌙 DAILY MODE'} — ${new Date().toISOString()}\n`);

  if (!GEMINI_KEY) {
    console.error('[pipeline] ✗ GEMINI_API_KEY is not set. Aborting.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  // Load (or create) unified master file
  const MASTER_FILE = path.join(OUT_DIR, 'ai_master.json');
  const master = loadJson(MASTER_FILE, { lastUpdated: null, teams: {}, matches: {}, days: {}, today_preview: {}, players: {} });
  if (!master.matches)       master.matches       = {};
  if (!master.teams)         master.teams         = {};
  if (!master.players)       master.players       = {};
  if (!master.days)          master.days          = {};
  if (!master.today_preview) master.today_preview = {};

  const now       = new Date();
  const yesterday = new Date(now); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const today     = new Date(now.toISOString().slice(0,10) + 'T00:00:00Z');

  const processDates = RETRO_MODE ? datesFromTo(TOURNAMENT_START, yesterday) : [yesterday];
  console.log(`[pipeline] Processing ${processDates.length} day(s)…`);

  // ── Fetch standings ──
  let standings = {};
  try {
    standings = await fetchStandings();
    console.log(`[pipeline] Standings: ${Object.keys(standings).length} groups`);
  } catch (e) {
    console.warn(`[pipeline] ⚠ Standings unavailable: ${e.message}`);
  }

  // ── Collect completed matches + summaries ──
  const allCompleted = [];
  const summaries    = {};
  const teamsSeen    = {};
  const playersSeen  = {};

  for (const date of processDates) {
    const label = isoDate(date);
    let dayMatches = [];
    try {
      dayMatches = await fetchDayMatches(date);
    } catch (e) {
      console.warn(`[pipeline] ⚠ ${label}: could not fetch matches — ${e.message}`);
      continue;
    }

    const completed = dayMatches.filter(m => m.status === 'post');
    if (!completed.length) { console.log(`[pipeline] ${label}: no completed matches`); continue; }
    console.log(`[pipeline] ${label}: ${completed.length} completed matches`);
    allCompleted.push(...completed);

    await Promise.all(completed.map(async m => {
      try {
        summaries[m.id] = await fetchSummary(m.id);
      } catch (e) {
        console.warn(`[pipeline]   ⚠ summary ${m.id} failed: ${e.message}`);
        summaries[m.id] = { keyEvents: [], teamStats: {} };
      }

      // Track teams for status updates
      for (const { team, abbr } of [{ team: m.homeTeam, abbr: m.homeAbbr }, { team: m.awayTeam, abbr: m.awayAbbr }]) {
        let group = '';
        for (const [g, entries] of Object.entries(standings)) {
          if (entries.some(e => e.abbr === abbr)) { group = g; break; }
        }
        teamsSeen[abbr] = { team, abbr, group, match: { ...m } };
      }

      // Track top-50 players from key events
      for (const ev of summaries[m.id]?.keyEvents || []) {
        const name = ev.athlete;
        if (name && TOP50.has(name)) {
          const k = `${name}||${ev.teamAbbr}`;
          if (!playersSeen[k]) playersSeen[k] = { name, teamAbbr: ev.teamAbbr, events: [], matchId: m.id };
          playersSeen[k].events.push(ev);
        }
      }
    }));

    if (RETRO_MODE) await sleep(300);
  }

  // ── 1. Match summaries ──
  const newMatches = allCompleted.filter(m => !master.matches[m.id]);
  if (newMatches.length) {
    console.log(`\n[pipeline] Generating summaries for ${newMatches.length} new match(es)…`);
    for (let i = 0; i < newMatches.length; i += BATCH_SIZE) {
      const batch = newMatches.slice(i, i + BATCH_SIZE);
      try {
        const results = await genMatchSummaries(batch, summaries);
        Object.assign(master.matches, results);
        console.log(`  ✓ batch ${Math.floor(i/BATCH_SIZE)+1}: ${Object.keys(results).length} summaries`);
      } catch (e) {
        console.error(`  ✗ batch ${Math.floor(i/BATCH_SIZE)+1} failed: ${e.message}`);
        saveLog('matches-error', { batch: batch.map(m => m.id), error: e.message });
      }
      if (i + BATCH_SIZE < newMatches.length) await sleep(6000);
    }
  }
  master.lastUpdated = now.toISOString();
  saveJson(MASTER_FILE, master);
  await sleep(6000);

  // ── 2. Team statuses ──
  const teamsList = Object.values(teamsSeen);
  if (teamsList.length) {
    console.log(`\n[pipeline] Generating team statuses for ${teamsList.length} team(s)…`);
    try {
      const results = await genTeamStatuses(teamsList, standings);
      Object.assign(master.teams, results);
      console.log(`  ✓ ${Object.keys(results).length} team statuses`);
    } catch (e) {
      console.error(`  ✗ team statuses failed: ${e.message}`);
      saveLog('teams-error', { error: e.message });
    }
  }
  master.lastUpdated = now.toISOString();
  saveJson(MASTER_FILE, master);
  await sleep(6000);

  // ── 3. Player verdicts ──
  const playersList = Object.values(playersSeen);
  if (playersList.length) {
    console.log(`\n[pipeline] Generating verdicts for ${playersList.length} top-50 player(s)…`);
    try {
      const results = await genPlayerVerdicts(playersList);
      Object.assign(master.players, results);
      console.log(`  ✓ ${Object.keys(results).length} player verdicts`);
    } catch (e) {
      console.error(`  ✗ player verdicts failed: ${e.message}`);
      saveLog('players-error', { error: e.message });
    }
  }
  master.lastUpdated = now.toISOString();
  saveJson(MASTER_FILE, master);
  await sleep(6000);

  // ── 4. Daily recap ──
  const recapDay = allCompleted.filter(m => isoDate(new Date(m.date)) === isoDate(yesterday));
  if (recapDay.length) {
    console.log(`\n[pipeline] Generating daily recap for ${isoDate(yesterday)}…`);
    try {
      const recap = await genDailyRecap(recapDay, standings);
      if (recap) {
        master.days[isoDate(yesterday)] = recap;
        master.lastUpdated = now.toISOString();
        saveJson(MASTER_FILE, master);
      }
    } catch (e) {
      console.error(`  ✗ daily recap failed: ${e.message}`);
      saveLog('recap-error', { error: e.message });
    }
  }
  await sleep(6000);

  // ── 5. Today's preview ──
  console.log(`\n[pipeline] Generating today's preview for ${isoDate(today)}…`);
  try {
    const todayMatches = await fetchDayMatches(today);
    const upcoming = todayMatches.filter(m => m.status === 'pre' || m.status === 'scheduled' || !m.status);
    if (upcoming.length) {
      const preview = await genTodayPreview(upcoming, standings);
      if (preview) {
        master.today_preview = preview;
        master.lastUpdated = now.toISOString();
        saveJson(MASTER_FILE, master);
      }
    } else {
      console.log('  — no upcoming matches today, skipping preview');
    }
  } catch (e) {
    console.error(`  ✗ today preview failed: ${e.message}`);
    saveLog('preview-error', { error: e.message });
  }

  console.log(`\n[pipeline] ✅ Done in ${((Date.now()-startTime)/1000).toFixed(1)}s\n`);
}

main().catch(e => {
  console.error('[pipeline] ✗ Fatal:', e.message);
  process.exit(1);
});
