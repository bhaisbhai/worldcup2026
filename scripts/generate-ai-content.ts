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

// Look up a single team's group stage record from any group in the standings.
// Used in knockout stage to show how each team performed to get here.
function teamTournamentRecord(abbr: string, standingsGroups: any[]): string {
  for (const g of standingsGroups) {
    const entries: any[] = g.standings?.entries || [];
    const idx   = entries.findIndex((e: any) => e.team?.abbreviation === abbr);
    if (idx === -1) continue;
    const entry = entries[idx];
    const stats = entry.stats || [];
    const getStat = (...names: string[]) => {
      for (const n of names) {
        const v = Number(stats.find((s: any) => s.name === n)?.value || 0);
        if (v) return v;
      }
      return 0;
    };
    const pts = getStat('points');
    const mp  = getStat('gamesPlayed');
    const gf  = getStat('pointsFor', 'goalsFor');
    const ga  = getStat('pointsAgainst', 'goalsAgainst');
    const gd  = gf - ga;
    const pos = ['1st', '2nd', '3rd', '4th'][idx] || `${idx + 1}th`;
    const name = entry.team?.displayName || abbr;
    return `${name}: finished ${pos} in ${g.name || 'group'} — ${mp} games, ${pts}pts, GF${gf} GA${ga} GD${gd >= 0 ? '+' : ''}${gd}`;
  }
  return '';
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

  // Detect knockout stage by event name (Round of 32, QF, SF, Final)
  const isKnockoutStage = events.some(e => {
    const n = (e.name || '').toLowerCase();
    return n.includes('round of') || n.includes('quarter-final') ||
           n.includes('semi-final') || (n.includes('final') && !n.includes('group'));
  });
  if (isKnockoutStage) console.log('🏆  Knockout stage detected.');

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

    // Only count games that have already kicked off as "incomplete" — future placeholder
    // slots on ESPN's scoreboard would otherwise falsely block the pipeline.
    const nowMs = Date.now();
    const incomplete = events.filter(e => new Date(e.date).getTime() < nowMs && !e.status?.type?.completed);
    if (incomplete.length > 0) {
      console.log(`⏳  ${incomplete.length} game(s) still in progress.`);
      process.exit(0);
    }
    if (events.length > 0) {
      const latestKickoff = Math.max(...events.map(e => new Date(e.date).getTime()));
      // 150 min covers knockout extra time + penalty shootout; group games finish well within this.
      const eligibleAt = latestKickoff + (150 + 60) * 60 * 1000;
      if (Date.now() < eligibleAt) {
        const mins = Math.ceil((eligibleAt - Date.now()) / 60000);
        console.log(`⏳  Within post-game buffer. ${mins}m remaining.`);
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

  // ── 3b. Patch missing goal scorers ────────────────────────────────────────
  // If ESPN's comp.details has fewer goals than the actual scoreline (common for ET
  // goals), ask Gemini to identify the missing scorers and persist them to
  // data/goal-patches.json so the app can display them immediately.
  const patchesPath = path.resolve(__dirname, '..', 'data', 'goal-patches.json');
  const existingPatches: Record<string, any[]> = fs.existsSync(patchesPath)
    ? JSON.parse(fs.readFileSync(patchesPath, 'utf-8'))
    : {};

  for (const ev of events) {
    const comp = ev.competitions?.[0] || {};
    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeScore = parseInt(home.score ?? '0') || 0;
    const awayScore = parseInt(away.score ?? '0') || 0;
    const totalExpected = homeScore + awayScore;
    if (totalExpected === 0) continue;

    const details = (comp.details || [])
      .filter((d: any) => {
        const t = (d.type?.text || d.type?.name || '').toLowerCase();
        return t.includes('goal') || t === 'score';
      })
      .filter((d: any) => {
        const n = d.athletesInvolved?.[0]?.shortName ||
          d.participants?.find((p: any) => p.type === 'scorer' || p.order === 1)?.athlete?.shortName;
        return !!n; // only count goals we actually have a name for
      });

    const dateStr = new Date(ev.date).toISOString().slice(0, 10);
    const homeAbbr = home.team?.abbreviation || '';
    const awayAbbr = away.team?.abbreviation || '';
    const patchKey = `${homeAbbr}-${awayAbbr}-${dateStr}`;
    const existingPatch: any[] = existingPatches[patchKey] || [];
    const knownCount = details.length + existingPatch.length;

    if (knownCount < totalExpected) {
      const missing = totalExpected - knownCount;
      console.log(`⚽  ${homeAbbr} ${homeScore}-${awayScore} ${awayAbbr}: ${missing} goal(s) missing from ESPN feed — asking Gemini`);
      const knownGoals = details.map((d: any) => {
        const n = d.athletesInvolved?.[0]?.shortName ||
          d.participants?.find((p: any) => p.type === 'scorer' || p.order === 1)?.athlete?.shortName || '';
        const min = d.clock?.displayValue || '';
        const isHome = d.team?.id === home.team?.id;
        return `${n} ${min} (${isHome ? home.team?.displayName : away.team?.displayName})`;
      });
      existingPatch.forEach((p: any) => knownGoals.push(`${p.name} ${p.min} (already patched)`));

      try {
        const result = await callGemini(`You are a football data assistant. Final score: ${home.team?.displayName} ${homeScore}–${awayScore} ${away.team?.displayName} on ${dateStr} (FIFA World Cup 2026).
Known goal scorers from official data: ${knownGoals.join(', ') || 'none'}.
There are ${missing} goal(s) missing. Identify the missing scorer(s) including minute and whether it was a penalty or own goal.
Reply ONLY with a JSON array of objects: [{"name":"Shortname e.g. J. Smith","min":"97'","isHome":true,"og":false,"pen":true}]
isHome = true if scored for ${home.team?.displayName}.
If genuinely unknown, return [].`);
        if (Array.isArray(result) && result.length > 0) {
          // Deduplicate against what we already know
          const fresh = result.filter((p: any) =>
            !existingPatch.some((e: any) => e.name === p.name && e.min === p.min)
          );
          if (fresh.length > 0) {
            existingPatches[patchKey] = [...existingPatch, ...fresh];
            console.log(`✅  Patched: ${fresh.map((p: any) => `${p.name} ${p.min}`).join(', ')}`);
          }
        }
      } catch (e) {
        console.warn(`⚠️  Could not research missing goals for ${patchKey}:`, e);
      }
    }
  }

  fs.writeFileSync(patchesPath, JSON.stringify(existingPatches, null, 2) + '\n');
  console.log(`✅  goal-patches.json updated`);

  // ── 4. Fetch current ESPN standings ────────────────────────────────────────
  let standingsGroups: any[] = [];
  try {
    const sd = await fetchJSON('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings');
    standingsGroups = sd.children || [];
  } catch (e) {
    console.warn('⚠️  Could not fetch standings:', e);
  }

  // Determine if the group stage is complete by checking whether every team in every
  // group has played 3 games. ESPN doesn't put round info in knockout event names, so
  // we infer stage from standings instead of parsing event metadata.
  const isGroupStageComplete = standingsGroups.length > 0 && standingsGroups.every(g => {
    const entries: any[] = g.standings?.entries || [];
    return entries.length > 0 && entries.every((e: any) => {
      const mp = Number((e.stats || []).find((s: any) => s.name === 'gamesPlayed')?.value || 0);
      return mp >= 3;
    });
  });
  if (isGroupStageComplete) console.log('🏆  Group stage complete — knockout detected via standings.');

  // ── 5. Fetch upcoming games (tomorrow) ─────────────────────────────────────
  const upcomingMatches: any[] = [];
  // tomorrowIsKnockout uses standings-based detection so it works even when ESPN
  // gives no round info in event names (which is the case for the 2026 tournament).
  const tomorrowIsKnockout = isGroupStageComplete;

  try {
    const tds = tomorrowStr.replace(/-/g, '');
    const tSb  = await fetchJSON(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${tds}`
    );
    if (tomorrowIsKnockout) console.log('🏆  Staking tomorrow as knockout stage.'); else console.log('ℹ️  Staking tomorrow as group stage.');

    for (const ev of tSb.events || []) {
      const comp = ev.competitions?.[0] || {};
      const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeAbbr = home.team?.abbreviation || '';
      const awayAbbr = away.team?.abbreviation || '';

      let matchCtx = '';
      if (tomorrowIsKnockout) {
        const roundName = ev.name || ev.shortName || '';
        const homeRecord = teamTournamentRecord(homeAbbr, standingsGroups);
        const awayRecord = teamTournamentRecord(awayAbbr, standingsGroups);
        const parts: string[] = [];
        if (roundName) parts.push(`Round: ${roundName}`);
        if (homeRecord) parts.push(`Group stage performance: ${homeRecord}`);
        if (awayRecord) parts.push(`Group stage performance: ${awayRecord}`);
        matchCtx = parts.join('\n');
      } else {
        // Group stage: find their shared group and attach standings
        for (const g of standingsGroups) {
          const entries: any[] = g.standings?.entries || [];
          const abbrs = entries.map((e: any) => e.team?.abbreviation);
          if (abbrs.includes(homeAbbr) || abbrs.includes(awayAbbr)) {
            matchCtx = `${g.name || 'Group'}:\n${groupStandingsText(entries)}`;
            break;
          }
        }
      }

      upcomingMatches.push({
        matchKey: `${homeAbbr}-${awayAbbr}`,
        homeTeam: home.team?.displayName || homeAbbr,
        awayTeam: away.team?.displayName || awayAbbr,
        groupCtx: matchCtx,
      });
    }
    console.log(`📋  ${upcomingMatches.length} upcoming match(es) found for ${tomorrowStr}`);
  } catch (e) {
    console.warn(`⚠️  Could not fetch tomorrow's schedule:`, e);
  }

  // ── 6. AI Call 1 — Recap ─────────────────────────────────────────────────
  const qualRules = isKnockoutStage
    ? `FIFA World Cup 2026 knockout stage. Win = advance to next round. Lose = eliminated. If level after 90 minutes: 30 minutes extra time, then penalty shootout if still level. No draws possible.`
    : `World Cup 2026 format: 48 teams, 12 groups of 4.
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

${isKnockoutStage
  ? `CRITICAL RULE FOR PROGRESSION: These are knockout matches. ALWAYS report which teams advanced to the next round and which were eliminated. Write 1-2 clear sentences. If there was extra time or penalties, mention that.`
  : `CRITICAL RULE FOR PROGRESSION: Only report teams that appear in today's match results above. If a team did not play today, their status cannot have changed today — do not mention them regardless of their standings position.`}

Return JSON with exactly these two fields:
{
  "summary": "Results only: 40-50 words on key scores and goal scorers. No qualification info here.",
  "progression": "${isKnockoutStage
    ? 'Which teams advanced to the next round, and which were eliminated? Write 1-2 sentences.'
    : 'Among the teams that played TODAY (and only those teams), which ones newly secured qualification or were newly eliminated as a direct result of today\'s specific result? Write 1-2 sentences of news narrative. If none of today\'s teams changed status, return empty string.'}"
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

For each upcoming World Cup match below, write a 20-25 word factual stakes summary.${tomorrowIsKnockout
  ? ' These are knockout matches. Reference how each team performed during the group stage (use the data provided). Mention their group stage record or how they progressed. Winner advances, loser is eliminated.'
  : ' Explain what each team needs to advance. Use ONLY the current standings provided. Do not invent facts or results.'}

${tomorrowIsKnockout
  ? `FIFA World Cup 2026 knockout stage. Win = advance to next round. Lose = eliminated. If level after 90 minutes: 30 minutes extra time, then penalty shootout if still level. No draws possible.`
  : qualRules}

${matchBlock}

Return JSON with this exact structure:
{
  "stakes": [
    {
      "matchKey": "HOME-AWAY abbreviation exactly as given",
      "summary": "20-25 word factual stakes description",
      "status": ${tomorrowIsKnockout ? '"Must Win"' : '"Elimination Risk" or "Qualification Battle" or "Knockout Seeding"'}
    }
  ]
}

${tomorrowIsKnockout
  ? `Status definitions:
- "Must Win": knockout match — winner advances to next round, loser eliminated

IMPORTANT: For knockout matches, your summary must reference each team's group stage journey (e.g. finishing position, record). Do NOT use generic phrases like "crucial knockout clash" — cite actual stats from the group stage data provided.`
  : `Status definitions:
- "Elimination Risk": at least one team faces elimination with a bad result
- "Qualification Battle": both teams are fighting for a qualification spot
- "Knockout Seeding": both teams already qualified, competing only for group position/seeding`}`;

    try {
      const res = await callGemini(stakesPrompt);
      for (const s of (res?.stakes || [])) {
        if (s.matchKey && s.summary) {
          stakesOut[s.matchKey] = {
            summary: s.summary,
            status:  s.status || (tomorrowIsKnockout ? 'Must Win' : 'Qualification Battle'),
          };
        }
      }
      console.log(`✅  Stakes generated for ${Object.keys(stakesOut).length} match(es)`);
    } catch (e) {
      console.error('❌  Stakes generation failed:', e);
    }
  }

  // ── 7b. AI Call 3 — Quality gate: verify stakes summaries ─────────────────
  // A second Gemini call reviews each summary and auto-corrects ones that use
  // wrong language (e.g. group-stage qualifying terms in a knockout match, or
  // generic filler instead of citing actual team performance).
  if (Object.keys(stakesOut).length > 0) {
    console.log('🔍  Running stakes quality check…');
    const badPhrases = tomorrowIsKnockout
      ? ['needs to', 'needs a', 'needs points', 'needs a win to qualify', 'needs a draw to qualify',
         'best third', 'third-place', 'automatic qualification', 'advance from group', 'group stage',
         'crucial clash', 'crucial knockout', 'crucial match']
      : [];

    const qualityItems = Object.entries(stakesOut).map(([k, v]) => `${k}: "${v.summary}"`).join('\n');
    const qualityPrompt = `You are a quality-checker for a football fan app.

Each line below is a pre-match summary for an UPCOMING ${tomorrowIsKnockout ? 'KNOCKOUT' : 'GROUP STAGE'} World Cup match.

Quality criteria for ${tomorrowIsKnockout ? 'KNOCKOUT' : 'GROUP STAGE'} summaries:
${tomorrowIsKnockout
  ? `- Must describe the match as knockout (winner advances, loser out)
- Must reference each team's actual group stage performance (finishing position, points, goals) — no invented stats
- Must NOT use group-stage qualification language: "needs X points", "best third-place", "automatic qualification", "advance from group", "group stage"
- Must NOT be generic filler like "crucial knockout clash" with no actual team data
- Should be 20-25 words`
  : `- Must explain what each team needs to advance in the group
- Must reference current standings (points, position)
- Should be 20-25 words`}

Summaries to review:
${qualityItems}

For each summary, decide: does it pass the criteria above?
If it FAILS, write a corrected 20-25 word summary that fixes the issue.
If it PASSES, repeat the original summary unchanged.

Return JSON:
{
  "results": [
    { "matchKey": "...", "passes": true, "summary": "original or corrected summary" }
  ]
}`;

    try {
      const qr = await callGemini(qualityPrompt);
      let fixed = 0, passed = 0;
      for (const r of (qr?.results || [])) {
        if (!r.matchKey || !r.summary) continue;
        if (r.passes) {
          passed++;
        } else {
          fixed++;
          console.log(`🔧  Fixed summary for ${r.matchKey}`);
          stakesOut[r.matchKey] = { ...stakesOut[r.matchKey], summary: r.summary };
        }
      }
      console.log(`✅  Quality check: ${passed} passed, ${fixed} corrected`);
    } catch (e) {
      console.warn('⚠️  Quality check failed (keeping original stakes):', e);
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
