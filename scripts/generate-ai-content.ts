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
        model: 'gemini-2.5-flash',
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

  // Use Pacific Time (America/Los_Angeles) so late West Coast games are attributed to the correct date
  const ptDate = (d = new Date()) =>
    d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // en-CA gives YYYY-MM-DD

  // Default: process yesterday in PT (pipeline runs after midnight PT)
  const targetDate = dateArg || (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return ptDate(d);
  })();

  // Calculate tomorrow in PT upfront — needed for both self-gating and stakes fetch
  const tomorrowPT = new Date(`${targetDate}T12:00:00`);
  tomorrowPT.setDate(tomorrowPT.getDate() + 1);
  const tomorrowStr = ptDate(tomorrowPT);

  console.log(`📅  Target date: ${targetDate}  tomorrow: ${tomorrowStr}  force=${force}`);

  // ── 1. Fetch yesterday's scoreboard ───────────────────────────────────────
  const ds = targetDate.replace(/-/g, '');
  const scoreboard = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ds}`
  );
  const events: any[] = scoreboard.events || [];

  // ── 2. Self-gating ─────────────────────────────────────────────────────────
  // Skip only when BOTH recap and tomorrow's stakes are already generated.
  // If stakes are missing (e.g. games finished after a previous partial run),
  // continue so the stakes are regenerated with up-to-date standings.
  if (!force) {
    const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
    const stakesPath = path.resolve(__dirname, '..', 'data', 'stakes.json');

    let recapDone = false;
    if (fs.existsSync(recapsPath)) {
      const existing: any[] = JSON.parse(fs.readFileSync(recapsPath, 'utf-8'));
      recapDone = existing.some(r => r.date === targetDate && r.summary);
    }

    let stakesDone = false;
    if (fs.existsSync(stakesPath)) {
      const existing: any = JSON.parse(fs.readFileSync(stakesPath, 'utf-8'));
      stakesDone = Object.keys(existing.byDate?.[tomorrowStr] || {}).length > 0;
    }

    if (recapDone && stakesDone) {
      console.log(`✅  Recap for ${targetDate} and stakes for ${tomorrowStr} already exist — skipping.`);
      process.exit(0);
    }

    if (recapDone) console.log(`ℹ️  Recap exists but stakes for ${tomorrowStr} missing — regenerating stakes.`);

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

  // ── 6. AI Call 1 — Recap ─────────────────────────────────────────────────
  const qualRules = `World Cup 2026 format: 48 teams, 12 groups of 4.
Qualification rules:
- Top 2 from each group qualify automatically (guaranteed).
- Best 8 third-place teams across all 12 groups also advance.
- 3rd place with 4+ points: solid best-3rd contender.
- 3rd place with 3 points: slim but real chance (has happened historically).
- 3rd place with 0-1 points maximum possible: cannot realistically qualify.
- 4th place: always eliminated, no best-3rd route.
Mathematical certainty rules — BE CONSERVATIVE, only state these when 100% certain:
- QUALIFIED: a team is guaranteed top-2 when no other team in the group can mathematically overtake them regardless of remaining results.
- ELIMINATED: ONLY when BOTH are true: (1) the team mathematically cannot finish top-2, AND (2) their maximum possible points total is 0 or 1 (making best-3rd mathematically impossible). A team with any chance of reaching 3+ points is NOT eliminated. When in doubt, do NOT call a team eliminated.`;

  // Build a list of teams already announced as qualified/eliminated in prior recaps
  // so the AI doesn't re-announce them today.
  // For entries with a dedicated `progression` field, use that.
  // For older entries where qualification info is embedded in `summary`, use the full summary
  // so the AI can extract what was already reported.
  let alreadyAnnouncedText = '';
  try {
    const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
    if (fs.existsSync(recapsPath)) {
      const allRecaps: any[] = JSON.parse(fs.readFileSync(recapsPath, 'utf-8'));
      const priorLines = allRecaps
        .filter(r => r.date < targetDate)
        .map(r => {
          const text = r.progression || r.progressionNews || r.summary || r.headline || '';
          return text ? `[${r.date}] ${text}` : null;
        })
        .filter(Boolean) as string[];
      if (priorLines.length > 0) {
        alreadyAnnouncedText = `\nPrevious days' match reports (includes teams already reported as qualified/eliminated — DO NOT repeat any team already mentioned here):\n${priorLines.join('\n')}`;
      }
    }
  } catch {}

  let recapSummary = '';
  let recapProgression = '';
  if (recapLines.length > 0) {
    console.log('🤖  Generating recap…');

    const allStandingsText = standingsGroups.map(g => {
      const entries: any[] = g.standings?.entries || [];
      return `${g.name || 'Group'}:\n${groupStandingsText(entries)}`;
    }).join('\n\n');

    const recapPrompt = `You are a football journalist writing a brief match report.

Write a factual summary of these World Cup results. Use ONLY the data provided below. Do not invent scorers, statistics, or match events that are not listed.

${qualRules}

Match results:
${recapLines.join('\n')}

Current group standings (after today's games):
${allStandingsText}
${alreadyAnnouncedText}

CRITICAL RULE FOR PROGRESSION: Only report teams that appear in today's match results above. If a team did not play today, their status cannot have changed today — do not mention them regardless of their standings position.

Return JSON with exactly these two fields:
{
  "summary": "Results only: 40-50 words on key scores and goal scorers. No qualification info here.",
  "progression": "Among the teams that played TODAY (and only those teams), which ones newly secured qualification or were newly eliminated as a direct result of today's specific result? Write 1-2 sentences of news narrative. If none of today's teams changed status, return empty string."
}`;

    try {
      const res = await callGemini(recapPrompt);
      recapSummary = res?.summary || '';
      recapProgression = res?.progression || '';
      console.log(`✅  Recap generated (${recapSummary.split(' ').length} words, progression: ${recapProgression ? 'yes' : 'none'})`);
    } catch (e) {
      console.error('❌  Recap generation failed:', e);
    }
  }

  // ── 7. AI Call 2 — Stakes (20 words per match) ────────────────────────────
  const stakesOut: Record<string, { summary: string; status: string }> = {};
  if (upcomingMatches.length > 0) {
    console.log('🤖  Generating stakes…');

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
    const entry: any = { date: targetDate, summary: recapSummary };
    if (recapProgression) entry.progression = recapProgression;
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
