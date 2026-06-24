import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function callGemini(prompt: string, retries = 5): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-lite',
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0 },
      });
      const raw = (response.text || '').trim().replace(/^```json\n?/, '').replace(/```$/, '').trim();
      return JSON.parse(raw);
    } catch (err: any) {
      const msg = err.message || '';
      if (attempt < retries) {
        const wait = msg.includes('429') ? 60000 : msg.includes('503') ? 30000 : 5000;
        console.warn(`⚠️  Gemini attempt ${attempt} failed: ${msg}. Retrying in ${wait / 1000}s`);
        await sleep(wait);
      } else throw err;
    }
  }
}

// Build a human-readable standings block for a group
function groupStandingsText(entries: any[]): string {
  return entries.map((e: any) => {
    const stats = e.stats || [];
    const getStat = (n: string) => Number(stats.find((s: any) => s.name === n)?.value || 0);
    const abbr = e.team?.abbreviation || '';
    const name = e.team?.displayName || '';
    const pts  = getStat('points');
    const mp   = getStat('gamesPlayed');
    const gf   = getStat('pointsFor') || getStat('goalsFor');
    const ga   = getStat('pointsAgainst') || getStat('goalsAgainst');
    const gd   = gf - ga;
    const left = 3 - mp;
    return `  ${name} (${abbr}): ${mp}P  ${pts}pts  GD${gd >= 0 ? '+' : ''}${gd}  ${left} game${left !== 1 ? 's' : ''} left`;
  }).join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find(a => a.startsWith('--date='))?.split('=')[1];
  const force   = args.includes('--force');

  // Default: process yesterday (pipeline runs after midnight)
  const targetDate = dateArg || (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  })();

  console.log(`📅  Target date: ${targetDate}  force=${force}`);

  // ── 1. Fetch yesterday's scoreboard ───────────────────────────────────────
  const ds = targetDate.replace(/-/g, '');
  const scoreboard = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ds}`
  );
  const events: any[] = scoreboard.events || [];

  // ── 2. Self-gating ─────────────────────────────────────────────────────────
  if (!force) {
    const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
    if (fs.existsSync(recapsPath)) {
      const existing: any[] = JSON.parse(fs.readFileSync(recapsPath, 'utf-8'));
      if (existing.some(r => r.date === targetDate && r.summary)) {
        console.log(`✅  Recap for ${targetDate} already exists — skipping.`);
        process.exit(0);
      }
    }
    const incomplete = events.filter(e => !e.status?.type?.completed);
    if (incomplete.length > 0) {
      console.log(`⏳  ${incomplete.length} game(s) still in progress.`);
      process.exit(0);
    }
    if (events.length > 0) {
      const latestKickoff = Math.max(...events.map(e => new Date(e.date).getTime()));
      const eligibleAt = latestKickoff + (115 + 60) * 60 * 1000;
      if (Date.now() < eligibleAt) {
        const mins = Math.ceil((eligibleAt - Date.now()) / 60000);
        console.log(`⏳  Within 1h post-game buffer. ${mins}m remaining.`);
        process.exit(0);
      }
    }
    console.log(`✅  All ${events.length} game(s) complete. Generating…`);
  } else {
    console.log('⚡  --force: skipping readiness checks.');
  }

  // ── 3. Build recap context: scores + goal scorers only ────────────────────
  // We do NOT pass stats (shots, possession etc.) — that's where hallucination crept in.
  const recapLines: string[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0] || {};
    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeTeam  = home.team?.displayName || 'Home';
    const awayTeam  = away.team?.displayName || 'Away';
    const homeScore = home.score ?? '?';
    const awayScore = away.score ?? '?';

    const goals = (comp.details || [])
      .filter((d: any) => {
        const t = (d.type?.text || d.type?.name || '').toLowerCase();
        return t.includes('goal') || t === 'score';
      })
      .map((d: any) => {
        const scorer =
          d.athletesInvolved?.[0]?.shortName ||
          d.athletesInvolved?.[0]?.displayName ||
          d.participants?.find((p: any) => p.type === 'scorer' || p.order === 1)?.athlete?.shortName ||
          '';
        const min    = d.clock?.displayValue || '';
        const isHome = d.team?.id === home.team?.id;
        return scorer ? `${scorer}${min ? ' ' + min : ''} (${isHome ? homeTeam : awayTeam})` : null;
      })
      .filter(Boolean);

    recapLines.push(
      `${homeTeam} ${homeScore}–${awayScore} ${awayTeam}${goals.length ? '. Goals: ' + goals.join(', ') : ''}`
    );
  }

  // ── 4. Fetch current ESPN standings ────────────────────────────────────────
  let standingsGroups: any[] = [];
  try {
    const sd = await fetchJSON('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings');
    standingsGroups = sd.children || [];
  } catch (e) {
    console.warn('⚠️  Could not fetch standings:', e);
  }

  // ── 5. Fetch upcoming games (tomorrow) ─────────────────────────────────────
  const tomorrow = new Date(new Date(`${targetDate}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const upcomingMatches: any[] = [];

  try {
    const tds = tomorrowStr.replace(/-/g, '');
    const tSb  = await fetchJSON(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${tds}`
    );
    for (const ev of tSb.events || []) {
      const comp = ev.competitions?.[0] || {};
      const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeAbbr = home.team?.abbreviation || '';
      const awayAbbr = away.team?.abbreviation || '';

      // Find their group and attach standings
      let groupCtx = '';
      for (const g of standingsGroups) {
        const entries: any[] = g.standings?.entries || [];
        const abbrs = entries.map((e: any) => e.team?.abbreviation);
        if (abbrs.includes(homeAbbr) || abbrs.includes(awayAbbr)) {
          groupCtx = `${g.name || 'Group'}:\n${groupStandingsText(entries)}`;
          break;
        }
      }

      upcomingMatches.push({
        matchKey: `${homeAbbr}-${awayAbbr}`,
        homeTeam: home.team?.displayName || homeAbbr,
        awayTeam: away.team?.displayName || awayAbbr,
        groupCtx,
      });
    }
    console.log(`📋  ${upcomingMatches.length} upcoming match(es) found for ${tomorrowStr}`);
  } catch (e) {
    console.warn(`⚠️  Could not fetch tomorrow's schedule:`, e);
  }

  // ── 6. AI Call 1 — Recap (50 words, facts only) ───────────────────────────
  let recapSummary = '';
  if (recapLines.length > 0) {
    console.log('🤖  Generating recap…');
    const recapPrompt = `You are a football journalist writing a brief match report.

Write a factual 40-50 word summary of these World Cup results. Use ONLY the data provided below. Do not invent scorers, statistics, or match events that are not listed.

${recapLines.join('\n')}

Return JSON: {"summary": "your 40-50 word factual summary here"}`;

    try {
      const res = await callGemini(recapPrompt);
      recapSummary = res?.summary || '';
      console.log(`✅  Recap generated (${recapSummary.split(' ').length} words)`);
    } catch (e) {
      console.error('❌  Recap generation failed:', e);
    }
  }

  // ── 7. AI Call 2 — Stakes (20 words per match) ────────────────────────────
  const stakesOut: Record<string, { summary: string; status: string }> = {};
  if (upcomingMatches.length > 0) {
    console.log('🤖  Generating stakes…');

    const qualRules = `World Cup 2026 format: 48 teams, 12 groups of 4.
Qualification rules:
- Top 2 from each group qualify automatically (guaranteed).
- Best 8 third-place teams across all 12 groups also advance.
- 3rd place with 4+ points: realistic best-3rd contender.
- 3rd place with 3 or fewer points: very unlikely to advance.
- 4th place: always eliminated, no best-3rd route.`;

    const matchBlock = upcomingMatches.map((m, i) =>
      `Match ${i + 1}: ${m.homeTeam} vs ${m.awayTeam}  [key: ${m.matchKey}]\n${m.groupCtx}`
    ).join('\n\n');

    const stakesPrompt = `You are a football analyst providing pre-match context to fans.

For each upcoming World Cup match below, write a 15-20 word factual stakes summary explaining what each team needs to advance. Use ONLY the current standings provided. Do not invent facts or results.

${qualRules}

${matchBlock}

Return JSON with this exact structure:
{
  "stakes": [
    {
      "matchKey": "HOME-AWAY abbreviation exactly as given",
      "summary": "15-20 word factual stakes description",
      "status": "Elimination Risk" or "Qualification Battle" or "Knockout Seeding"
    }
  ]
}

Status definitions:
- "Elimination Risk": at least one team faces elimination with a bad result
- "Qualification Battle": both teams are fighting for a qualification spot
- "Knockout Seeding": both teams already qualified, competing only for group position/seeding`;

    try {
      const res = await callGemini(stakesPrompt);
      for (const s of (res?.stakes || [])) {
        if (s.matchKey && s.summary) {
          stakesOut[s.matchKey] = {
            summary: s.summary,
            status:  s.status || 'Qualification Battle',
          };
        }
      }
      console.log(`✅  Stakes generated for ${Object.keys(stakesOut).length} match(es)`);
    } catch (e) {
      console.error('❌  Stakes generation failed:', e);
    }
  }

  // ── 8. Write outputs ───────────────────────────────────────────────────────
  if (recapSummary) {
    const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
    let recaps: any[] = [];
    try { recaps = JSON.parse(fs.readFileSync(recapsPath, 'utf-8')); } catch {}
    const idx   = recaps.findIndex(r => r.date === targetDate);
    const entry = { date: targetDate, summary: recapSummary };
    if (idx !== -1) recaps[idx] = entry; else recaps.push(entry);
    recaps.sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(recapsPath, JSON.stringify(recaps, null, 2));
    console.log(`✅  data/recaps.json updated for ${targetDate}`);
  }

  if (Object.keys(stakesOut).length > 0) {
    const stakesPath = path.resolve(__dirname, '..', 'data', 'stakes.json');
    let existing: any = { byDate: {} };
    try { existing = JSON.parse(fs.readFileSync(stakesPath, 'utf-8')); } catch {}
    existing.byDate          = existing.byDate || {};
    existing.byDate[tomorrowStr] = stakesOut;
    existing.generatedAt     = new Date().toISOString();
    fs.writeFileSync(stakesPath, JSON.stringify(existing, null, 2));
    console.log(`✅  data/stakes.json updated for ${tomorrowStr}`);
  }
}

main().catch(err => {
  console.error('❌  Pipeline crashed:', err);
  process.exit(1);
});
