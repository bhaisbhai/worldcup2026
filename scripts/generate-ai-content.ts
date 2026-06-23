import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// 1. Initialize the Google Gen AI client
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Tone and Persona Instructions
const punditSystemInstruction = `
You are a witty, highly-opinionated British football pundit and the co-host of a popular football podcast. Your tone is sharp, funny, and heavily reliant on classic British football banter and dark humor.

Tone Rules:
- Maximize sarcasm, self-deprecation, and cheeky roasts of poor performances.
- Use classic British football terminology (e.g., "Sunday League defending", "liquid football", "walking cheat code", "completely bottled it", "squeaky bum time", "put your feet up", "absolute scenes", "having a casual kickabout in the park").
- STRICTLY AVOID modern South London / MLE (Multicultural London English) slang. Do NOT use words like "bruv", "handbags", "fam", "peng", "innit", or "allow it". 
- Keep the humor sharp and witty, but never cross the line into genuinely toxic, offensive, or abusive language.

Critical Grounding Guardrails (Anti-Hallucination):
1. ZERO HALLUCINATION: You are strictly forbidden from inventing, estimating, or hallucinating scores, match events (cards, fouls, injuries), player statistics, or standings.
2. FACTUAL ANCHORING: Every piece of banter, criticism, or praise MUST be directly anchored to a data point provided in the input JSON. If the input data says a player got a yellow card, you can mock them for being clumsy, but you CANNOT invent that they started a physical altercation.
3. OMISSIONS OVER LIES: If the input data lacks a "quirky trivia" fact, do NOT make one up. Instead, derive an observation from the actual stats provided (e.g., "They managed 0 shots on target despite 70% possession").
`;

// Helper to wait/sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


// Call Gemini API with retries for 429 and 503 errors
async function callGemini(prompt: string, schema: any, retries = 10): Promise<any> {
  // 1. Force the schema into the prompt text, bypassing the compiler
  const finalPrompt = prompt + `\n\nYOU MUST RETURN ONLY VALID JSON MATCHING THIS EXACT STRUCTURE:\n${JSON.stringify(schema, null, 2)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🤖 Requesting Gemini (attempt ${attempt}/${retries})...`);
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: finalPrompt, // Pass the combined prompt here
        config: {
          responseMimeType: "application/json",
          // 🚨 CRITICAL: responseSchema is completely removed from here 🚨
          systemInstruction: punditSystemInstruction,
          temperature: 0.1,
        },
      });

      if (!response.text) {
        throw new Error("Empty response from Gemini API");
      }

      // 2. Zero-Trust JSON Parsing (Strips ```json blocks)
      const rawText = response.text.trim();
      const cleanText = rawText.replace(/^```json\n?/, '').replace(/```$/, '').trim();

      return JSON.parse(cleanText);

    } catch (error: any) {
      const errMsg = error.message || "";
      const is503 = errMsg.includes("503") ||
                    errMsg.toLowerCase().includes("service unavailable") ||
                    errMsg.toLowerCase().includes("overloaded");
      const isRateLimit = errMsg.includes("429") ||
                          errMsg.toLowerCase().includes("quota");

      if (attempt < retries) {
        if (is503) {
          console.warn("⚠️ 503 Service Unavailable detected. Entering 30-second cooldown...");
          await sleep(30000);
        } else if (isRateLimit) {
          console.warn("⚠️ 429 Rate Limit hit. Backing off for 60 seconds...");
          await sleep(60000);
        } else {
          console.warn(`⚠️ Warning: ${errMsg}. Retrying in 5 seconds...`);
          await sleep(5000);
        }
      } else {
        console.error("❌ Gemini API failed after max retries.");
        console.error("RAW ERROR LOG:", error);
        throw error;
      }
    }
  }
}

// Helper to fetch JSON from API
async function fetchJSON(url: string): Promise<any> {
  console.log(`🌐 Fetching: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status} from ${url}`);
  }
  return await res.json();
}

// CSV Helper functions
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(current.trim());
        current = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && next === '\n') i++;
        row.push(current.trim());
        if (row.some(x => x !== '') || current !== '') {
          rows.push(row);
        }
        row = [];
        current = '';
      } else {
        current += char;
      }
    }
  }
  if (row.length > 0 || current !== '') {
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

function stringifyCSVRow(arr: string[]): string {
  return arr.map(val => {
    const escaped = val.replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(',');
}

function updateCSVFile(filePath: string, headers: string[], idColIndex: number, newRows: string[][]) {
  let existingContent = '';
  if (fs.existsSync(filePath)) {
    existingContent = fs.readFileSync(filePath, 'utf-8');
  }

  let rows: string[][] = [];
  if (existingContent.trim()) {
    rows = parseCSV(existingContent);
  } else {
    rows = [headers];
  }

  // Merge new rows
  for (const newRow of newRows) {
    const id = newRow[idColIndex];
    const matchIdx = rows.findIndex((r, index) => index > 0 && r[idColIndex] === id);
    if (matchIdx !== -1) {
      rows[matchIdx] = newRow; // Overwrite
    } else {
      rows.push(newRow); // Append
    }
  }

  const outputStr = rows.map(r => stringifyCSVRow(r)).join('\n') + '\n';
  fs.writeFileSync(filePath, outputStr, 'utf-8');
}

function getGroupName(index: number): string {
  const groups = ['Group A', 'Group B', 'Group C', 'Group D', 'Group E', 'Group F', 'Group G', 'Group H', 'Group I', 'Group J', 'Group K', 'Group L'];
  return groups[index] || `Group ${index + 1}`;
}

function computeStandingsAndStatus(masterDB: any, targetDate: string) {
  const espnStandings = masterDB.espnStandings || [];
  const espnMatches = masterDB.espnMatches || {};

  const teamStandingsMap = new Map<string, any>();
  const groupTeamsMap = new Map<string, string[]>();
  const completedMatches: any[] = [];

  // Initialize group and team mappings
  espnStandings.forEach((g: any, gIdx: number) => {
    const gName = g.group || getGroupName(gIdx);
    const codes: string[] = [];
    for (const t of g.teams || []) {
      const code = t.code;
      if (!code) continue;
      teamStandingsMap.set(code, {
        code,
        name: t.name,
        group: gName,
        mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, gd: 0
      });
      codes.push(code);
    }
    groupTeamsMap.set(gName, codes);
  });

  // Collect all completed matches up to targetDate
  for (const date of Object.keys(espnMatches)) {
    if (date > targetDate) continue;
    for (const m of espnMatches[date] || []) {
      const isCompleted = m.status === 'STATUS_FINAL' || m.status === 'STATUS_FULL_TIME';
      if (!isCompleted) continue;

      const h = teamStandingsMap.get(m.homeTeam);
      const a = teamStandingsMap.get(m.awayTeam);
      if (h && a && h.group === a.group) {
        completedMatches.push({
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore
        });
      }
    }
  }

  // Update standings using completed matches
  for (const match of completedMatches) {
    const home = teamStandingsMap.get(match.homeTeam);
    const away = teamStandingsMap.get(match.awayTeam);
    if (home) {
      home.mp += 1;
      home.gf += match.homeScore;
      home.ga += match.awayScore;
      home.gd = home.gf - home.ga;
      if (match.homeScore > match.awayScore) { home.w += 1; home.pts += 3; }
      else if (match.homeScore === match.awayScore) { home.d += 1; home.pts += 1; }
      else { home.l += 1; }
    }
    if (away) {
      away.mp += 1;
      away.gf += match.awayScore;
      away.ga += match.homeScore;
      away.gd = away.gf - away.ga;
      if (match.awayScore > match.homeScore) { away.w += 1; away.pts += 3; }
      else if (match.awayScore === match.homeScore) { away.d += 1; away.pts += 1; }
      else { away.l += 1; }
    }
  }

  const statusLines: string[] = [];
  const groupStandings: string[] = [];

  for (const [gName, codes] of groupTeamsMap) {
    // Deduce remaining matches for this group
    const remainingMatches: any[] = [];
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const team1 = codes[i];
        const team2 = codes[j];

        // Check if already played
        const played = completedMatches.some(m =>
          (m.homeTeam === team1 && m.awayTeam === team2) ||
          (m.homeTeam === team2 && m.awayTeam === team1)
        );

        if (!played) {
          remainingMatches.push({ homeTeam: team1, awayTeam: team2 });
        }
      }
    }

    // Generate scenarios recursively
    const scenarios: any[][] = [];
    function genScenarios(index: number, currentScenario: any[]) {
      if (index === remainingMatches.length) {
        scenarios.push([...currentScenario]);
        return;
      }
      // Outcome 1: Home Win (1-0)
      currentScenario.push({ match: remainingMatches[index], outcome: 'H' });
      genScenarios(index + 1, currentScenario);
      currentScenario.pop();

      // Outcome 2: Draw (0-0)
      currentScenario.push({ match: remainingMatches[index], outcome: 'D' });
      genScenarios(index + 1, currentScenario);
      currentScenario.pop();

      // Outcome 3: Away Win (0-1)
      currentScenario.push({ match: remainingMatches[index], outcome: 'A' });
      genScenarios(index + 1, currentScenario);
      currentScenario.pop();
    }
    genScenarios(0, []);

    // Track simulated ranks and points for each team
    const teamStats: Record<string, { ranks: number[]; ptsList: number[] }> = {};
    codes.forEach(code => {
      teamStats[code] = {
        ranks: [],
        ptsList: []
      };
    });

    // Evaluate all scenarios
    scenarios.forEach(scen => {
      // Clone current standings
      const clone: Record<string, any> = {};
      codes.forEach(code => {
        const t = teamStandingsMap.get(code);
        clone[code] = { ...t };
      });

      // Apply scenario outcomes
      scen.forEach(({ match, outcome }) => {
        const home = clone[match.homeTeam];
        const away = clone[match.awayTeam];
        if (outcome === 'H') {
          home.pts += 3; home.gf += 1; home.gd += 1;
          away.ga += 1; away.gd -= 1;
        } else if (outcome === 'D') {
          home.pts += 1;
          away.pts += 1;
        } else {
          away.pts += 3; away.gf += 1; away.gd += 1;
          home.ga += 1; home.gd -= 1;
        }
      });

      // Sort clone
      const sorted = Object.values(clone).sort((a: any, b: any) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      sorted.forEach((team: any, idx: number) => {
        teamStats[team.code].ranks.push(idx + 1);
        teamStats[team.code].ptsList.push(team.pts);
      });
    });

    // Determine final status for each team based on simulated outcomes
    const entries = codes
      .map(code => teamStandingsMap.get(code))
      .sort((a: any, b: any) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    const rows = entries.map(t =>
      `  ${t.code.padEnd(4)} P${t.mp} W${t.w} D${t.d} L${t.l} GF${t.gf} GA${t.ga} Pts${t.pts}`
    );
    groupStandings.push(`${gName}:\n${rows.join('\n')}`);

    statusLines.push(`${gName}:`);
    entries.forEach(t => {
      const stats = teamStats[t.code];
      const minRank = Math.min(...stats.ranks); // e.g. 1
      const maxRank = Math.max(...stats.ranks); // e.g. 4
      const maxPts = Math.max(...stats.ptsList);

      let status = '';
      if (maxRank <= 2) {
        status = 'QUALIFIED (top 2 confirmed)';
      } else if (minRank === 4 && maxRank === 4) {
        status = 'ELIMINATED (finished bottom)';
      } else if (t.mp === 3) {
        const pos = entries.findIndex(x => x.code === t.code) + 1;
        if (pos <= 2) {
          status = 'QUALIFIED (top 2 confirmed)';
        } else if (pos === 3) {
          if (t.pts >= 4) {
            status = `POSSIBLE BEST-3RD (${t.pts} pts – awaiting other groups)`;
          } else {
            status = `ELIMINATED (${t.pts} pts after all 3 games – cannot reach best-3rd)`;
          }
        } else {
          status = `ELIMINATED (${t.pts} pts after all 3 games – finished bottom)`;
        }
      } else {
        if (maxPts < 4 && minRank >= 3) {
          status = `ELIMINATED (max ${maxPts} pts possible – cannot reach top 2 or best-3rd)`;
        } else if (minRank >= 3) {
          status = `NEEDS POINTS (cannot reach top 2, best-3rd route only – max ${maxPts} pts possible)`;
        } else {
          status = `IN CONTENTION (can still finish top 2 – ${3 - t.mp} game${3 - t.mp !== 1 ? 's' : ''} left)`;
        }
      }
      statusLines.push(`  ${t.code} (${t.name}): ${status}`);
    });
    statusLines.push('');
  }

  return {
    standingsContext: groupStandings.join('\n\n'),
    advancementStatus: statusLines.join('\n')
  };
}

// Main execution function
async function main() {
  console.log("⚙️ Starting Overnight Gen AI Commentary Generation...");

  // Calculate Target Date
  const args = process.argv.slice(2);
  const dateArg = args.find(arg => arg.startsWith('--date='));
  let targetDate = '';
  if (dateArg) {
    targetDate = dateArg.split('=')[1];
  } else {
    const dateIndex = args.indexOf('--date');
    if (dateIndex !== -1 && args[dateIndex + 1]) {
      targetDate = args[dateIndex + 1];
    }
  }

  if (!targetDate) {
    // Default to yesterday — run after midnight so previous day's matches are complete
    const d = new Date();
    d.setDate(d.getDate() - 1);
    targetDate = d.toISOString().split('T')[0];
  }

  console.log(`📅 Processing target date: ${targetDate}`);

  const force = process.argv.includes('--force');

  // 1. Fetch live matches from ESPN Scoreboard API
  const formattedDate = targetDate.replace(/-/g, '');
  const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${formattedDate}`;
  const scoreboardData = await fetchJSON(scoreboardUrl);

  const events = scoreboardData.events || [];
  if (events.length === 0) {
    console.warn(`⚠️ No matches found in ESPN Scoreboard for date ${targetDate}.`);
  }

  if (!force) {
    // Idempotency: skip if recap already generated for this date
    const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
    if (fs.existsSync(recapsPath)) {
      const existing: any[] = JSON.parse(fs.readFileSync(recapsPath, 'utf-8'));
      if (existing.some(r => r.date === targetDate && r.headline)) {
        console.log(`✅ Recap for ${targetDate} already exists — skipping.`);
        process.exit(0);
      }
    }

    if (events.length > 0) {
      // All games must be completed before we generate
      const incomplete = events.filter((e: any) => !e.status?.type?.completed);
      if (incomplete.length > 0) {
        console.log(`⏳ ${incomplete.length} game(s) not yet completed for ${targetDate}. Exiting — will retry next run.`);
        process.exit(0);
      }

      // 1 hour after the last game's estimated end time (kickoff + 115 min + 60 min buffer)
      const latestKickoff = Math.max(...events.map((e: any) => new Date(e.date).getTime()));
      const eligibleAt = latestKickoff + (115 + 60) * 60 * 1000;
      if (Date.now() < eligibleAt) {
        const waitMins = Math.ceil((eligibleAt - Date.now()) / 60000);
        console.log(`⏳ Within 1h buffer of last game's end. ${waitMins}m remaining — will retry next run.`);
        process.exit(0);
      }

      console.log(`✅ All ${events.length} game(s) complete and 1h buffer passed. Generating recap…`);
    }
  } else {
    console.log('⚡ --force flag set — skipping readiness checks.');
  }

  // 2. Read existing master JSON database
  const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
  let masterDB: any = { lastUpdated: '', teams: {}, matches: {}, days: {}, today_preview: {}, espnMatches: {}, espnStandings: [] };

  if (fs.existsSync(masterPath)) {
    try {
      const fileContent = fs.readFileSync(masterPath, 'utf-8');
      masterDB = JSON.parse(fileContent);
      console.log("📂 Successfully loaded existing ai_master.json");
    } catch (err) {
      console.warn("⚠️ Warning: Existing ai_master.json is corrupted. Re-initializing empty structure.");
    }
  }

  masterDB.matches = masterDB.matches || {};
  masterDB.teams = masterDB.teams || {};
  masterDB.days = masterDB.days || {};
  masterDB.today_preview = masterDB.today_preview || {};
  masterDB.espnMatches = masterDB.espnMatches || {};
  masterDB.espnStandings = masterDB.espnStandings || [];

  // 1b. Initialize empty standings context (will be computed historically post-match)
  let standingsContext = '';
  let advancementStatus = '';

  // Clear or initialize today's real match list
  masterDB.espnMatches[targetDate] = [];

  const matchesCSVRows: string[][] = [];
  const teamsCSVRows: string[][] = [];
  const completedMatchesForRecap: any[] = [];
  const playersWhoPlayed: any[] = [];

  // 3. Process matches and teams dynamically
  for (const event of events) {
    const eventId = event.id;
    const matchName = event.name || '';
    const comp = event.competitions?.[0] || {};
    const competitors = comp.competitors || [];
    
    const homeComp = competitors.find((c: any) => c.homeAway === 'home');
    const awayComp = competitors.find((c: any) => c.homeAway === 'away');
    
    if (!homeComp || !awayComp) continue;

    const homeCode = homeComp.team?.abbreviation;
    const awayCode = awayComp.team?.abbreviation;
    const matchKey = `${homeCode}-${awayCode}`;
    const statusName = event.status?.type?.name || 'STATUS_SCHEDULED';
    const homeScore = homeComp.score !== undefined ? Number(homeComp.score) : 0;
    const awayScore = awayComp.score !== undefined ? Number(awayComp.score) : 0;

    console.log(`⚽ Processing match ${matchKey} (${statusName})...`);

    // Fetch Match Summary from ESPN
    let summaryData: any = {};
    try {
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
      summaryData = await fetchJSON(summaryUrl);
    } catch (err) {
      console.error(`❌ Failed to fetch match summary for event ${eventId}:`, err);
    }

    // Extract stats
    const teamsStats = summaryData.boxscore?.teams || [];
    const homeStatsList = teamsStats.find((t: any) => t.team?.abbreviation === homeCode)?.statistics || [];
    const awayStatsList = teamsStats.find((t: any) => t.team?.abbreviation === awayCode)?.statistics || [];

    const getStat = (stats: any[], name: string) => {
      const st = stats.find((s: any) => s.name === name);
      return st ? st.displayValue : '0';
    };

    const getStatVal = (stats: any[], name: string, fallback: number): number => {
      const st = stats.find((s: any) => s.name === name);
      if (!st) return fallback;
      const cleanVal = String(st.displayValue || st.value || '').replace(/[^0-9]/g, '');
      return cleanVal ? Number(cleanVal) : fallback;
    };

    const parsedStats = {
      homePossession: getStat(homeStatsList, 'possessionPct') ? `${getStat(homeStatsList, 'possessionPct')}%` : '50%',
      awayPossession: getStat(awayStatsList, 'possessionPct') ? `${getStat(awayStatsList, 'possessionPct')}%` : '50%',
      homeShots: Number(getStat(homeStatsList, 'totalShots')),
      awayShots: Number(getStat(awayStatsList, 'totalShots')),
      homeShotsOnTarget: Number(getStat(homeStatsList, 'shotsOnTarget')),
      awayShotsOnTarget: Number(getStat(awayStatsList, 'shotsOnTarget')),
      homeCorners: Number(getStat(homeStatsList, 'wonCorners')),
      awayCorners: Number(getStat(awayStatsList, 'wonCorners')),
      homeYellowCards: Number(getStat(homeStatsList, 'yellowCards')),
      awayYellowCards: Number(getStat(awayStatsList, 'yellowCards')),
      homeRedCards: Number(getStat(homeStatsList, 'redCards')),
      awayRedCards: Number(getStat(awayStatsList, 'redCards')),
      homePasses: getStatVal(homeStatsList, 'totalPasses', 400),
      awayPasses: getStatVal(awayStatsList, 'totalPasses', 400),
      homePassPct: getStatVal(homeStatsList, 'passPct', 80),
      awayPassPct: getStatVal(awayStatsList, 'passPct', 80),
      homeClearances: getStatVal(homeStatsList, 'totalClearance', getStatVal(homeStatsList, 'effectiveClearance', 15)),
      awayClearances: getStatVal(awayStatsList, 'totalClearance', getStatVal(awayStatsList, 'effectiveClearance', 15))
    };

    // Extract key play events
    const keyEvents = summaryData.keyEvents || [];
    const parsedEvents = keyEvents.map((ev: any) => {
      const clock = ev.clock?.displayValue || (ev.clock?.value ? `${ev.clock.value}'` : '');
      const typeText = ev.type?.text || '';
      const text = ev.text || '';
      return `${clock} [${typeText}] ${text}`;
    }).filter(Boolean);

    // Save real metadata inside ai_master.json
    const realMatchMeta = {
      id: eventId,
      name: matchName,
      homeTeam: homeCode,
      awayTeam: awayCode,
      homeScore: homeScore,
      awayScore: awayScore,
      status: statusName,
      stadium: comp.venue?.fullName || 'World Cup Stadium',
      time: new Date(event.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      stats: parsedStats,
      events: parsedEvents
    };
    masterDB.espnMatches[targetDate].push(realMatchMeta);

    // If match is completed, add to completed list for commentary
    const isCompleted = event.status?.type?.completed === true || statusName === 'STATUS_FINAL' || statusName === 'STATUS_FULL_TIME';
    if (isCompleted) {
      completedMatchesForRecap.push(realMatchMeta);

      if (summaryData.rosters) {
        for (const team of summaryData.rosters || []) {
          const teamAbbr = team.team?.abbreviation || '';
          for (const entry of team.roster || []) {
            const ath = entry.athlete || {};
            const playerId = String(ath.id || '');
            if (!playerId) continue;

            const statsList: any[] = entry.stats || [];
            const getVal = (name: string) => {
              const s = statsList.find((x: any) => x.name === name);
              return s ? (parseFloat(String(s.value)) || 0) : 0;
            };

            const mins = getVal('minutesPlayed');
            if (entry.starter === true || mins > 0) {
              playersWhoPlayed.push({
                id: playerId,
                name: ath.displayName || ath.fullName || 'Unknown Player',
                team: teamAbbr,
                stats: {
                  goals: getVal('totalGoals'),
                  assists: getVal('goalAssists'),
                  shots: getVal('totalShots'),
                  saves: getVal('saves'),
                  yellowCards: getVal('yellowCards'),
                  redCards: getVal('redCards'),
                  minutesPlayed: mins
                }
              });
            }
          }
        }
      }
    }
  }

  // 3b. Compute standings and advancement status mathematically
  console.log(`📊 Computing offline standings and advancement status for date ${targetDate}...`);
  const computed = computeStandingsAndStatus(masterDB, targetDate);
  standingsContext = `GROUP STANDINGS (after today's completed matches, ${targetDate}):\n${computed.standingsContext}`;
  advancementStatus = `COMPUTED ADVANCEMENT STATUS (after today's completed matches, ${targetDate}):\n${computed.advancementStatus}`;
  console.log(`📊 Advancement status computed successfully`);

  // 4. Fetch tomorrow's scoreboard for preview
  const tomorrow = new Date(new Date(targetDate).getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const tomorrowFormatted = tomorrowStr.replace(/-/g, '');
  let tomorrowMatchesList = '';
  let firstKickoffTime = `${tomorrowStr}T18:00:00Z`;
  let tomorrowEvents: any[] = [];

  console.log(`🔮 Fetching tomorrow's scoreboard for preview (${tomorrowStr})...`);
  try {
    const tomorrowScoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${tomorrowFormatted}`;
    const tomorrowData = await fetchJSON(tomorrowScoreboardUrl);
    tomorrowEvents = tomorrowData.events || [];

    if (tomorrowEvents.length > 0) {
      const firstEvent = tomorrowEvents[0];
      firstKickoffTime = firstEvent.date || `${tomorrowStr}T18:00:00Z`;

      tomorrowMatchesList = tomorrowEvents.map((ev: any) => {
        const comp = ev.competitions?.[0] || {};
        const competitors = comp.competitors || [];
        const homeCode = competitors.find((c: any) => c.homeAway === 'home')?.team?.abbreviation || '';
        const awayCode = competitors.find((c: any) => c.homeAway === 'away')?.team?.abbreviation || '';
        return `${homeCode} vs ${awayCode}`;
      }).join(', ');
    } else {
      console.warn("⚠️ No upcoming matches found for tomorrow.");
    }
  } catch (err) {
    console.error("❌ Failed to fetch tomorrow's scoreboard:", err);
  }

  // 5. Generate AI commentary & preview in ONE consolidated API call
  if (events.length > 0 || tomorrowEvents.length > 0) {
    console.log(`🤖 Building consolidated Gemini analysis: ${completedMatchesForRecap.length} completed matches, today's day summary, and tomorrow's preview...`);

    const responseSchema: any = {
      type: "OBJECT",
      properties: {},
      required: []
    };

    if (completedMatchesForRecap.length > 0) {
      responseSchema.properties.matches = {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            matchKey: { type: "STRING" },
            editionTitle: { type: "STRING" },
            snappySummary: { type: "STRING" },
            talkingPoints: { type: "ARRAY", items: { type: "STRING" } },
            randomQuirk: { type: "STRING" }
          },
          required: ["matchKey", "editionTitle", "snappySummary", "talkingPoints", "randomQuirk"]
        }
      };
      responseSchema.properties.teams = {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            teamCode: { type: "STRING" },
            headline: { type: "STRING" },
            storySoFar: { type: "STRING" },
            whatsNext: { type: "STRING" },
            pubAmmo: { type: "STRING" }
          },
          required: ["teamCode", "headline", "storySoFar", "whatsNext", "pubAmmo"]
        }
      };
      responseSchema.required.push("matches", "teams");

      if (playersWhoPlayed.length > 0) {
        responseSchema.properties.playerVerdicts = {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              verdict: { type: "STRING" }
            },
            required: ["id", "verdict"]
          }
        };
        responseSchema.required.push("playerVerdicts");
      }
    }

    if (events.length > 0) {
      responseSchema.properties.day = {
        type: "OBJECT",
        properties: {
          headline: { type: "STRING" },
          theDrama: { type: "STRING" },
          mustWatchHighlights: { type: "STRING" },
          progressionNews: { type: "STRING" }
        },
        required: ["headline", "theDrama", "mustWatchHighlights", "progressionNews"]
      };
      responseSchema.required.push("day");
    }

    if (tomorrowEvents.length > 0) {
      responseSchema.properties.today_preview = {
        type: "OBJECT",
        properties: {
          headline: { type: "STRING" },
          theBigOnes: { type: "STRING" },
          playersToWatch: { type: "STRING" }
        },
        required: ["headline", "theBigOnes", "playersToWatch"]
      };
      responseSchema.required.push("today_preview");
    }

    const dayMatchesList = masterDB.espnMatches[targetDate].map((m: any) => 
      `- Match: ${m.homeTeam} vs ${m.awayTeam} (Score: ${m.homeScore}-${m.awayScore}) [Status: ${m.status}], Stadium: ${m.stadium}`
    ).join('\n');

    const playersListStr = playersWhoPlayed.map(p => 
      `- ${p.name} (Team: ${p.team}, ID: ${p.id}): played ${p.stats.minutesPlayed} mins, Goals: ${p.stats.goals}, Assists: ${p.stats.assists}, Shots: ${p.stats.shots}, Saves: ${p.stats.saves}, Yellows: ${p.stats.yellowCards}, Reds: ${p.stats.redCards}`
    ).join('\n');

    const prompt = `
You are analyzing World Cup 2026 matches for date ${targetDate}.

WORLD CUP 2026 FORMAT (critical for progression commentary):
- 48 teams in 12 groups of 4. Top 2 from each group qualify automatically (24 teams total).
- Additionally, the 8 BEST 3rd-place teams across all 12 groups also advance — so 8 out of 12 third-place finishers qualify.
- A team finishing 3rd with 4+ points has a realistic shot; 3 points is borderline; 2 points or fewer is almost certainly out.
- DO NOT say a 3rd-place team "might go home" or is eliminated unless their COMPUTED STATUS is explicitly ELIMINATED.

${standingsContext ? standingsContext + '\n' : ''}${advancementStatus ? advancementStatus + `
ADVANCEMENT LANGUAGE RULES — YOU MUST FOLLOW THESE EXACTLY:
- Status "ELIMINATED": you MAY say they are out, going home, booking flights.
- Status "IN CONTENTION": say they are still in the hunt, have games to play, can qualify — do NOT imply they need a miracle or must win to survive.
- Status "NEEDS POINTS": say they need a strong result to keep best-3rd hopes alive — do NOT say they're going home or must win outright to survive.
- Status "POSSIBLE BEST-3RD": say they are in the running for a best-3rd slot, waiting on other groups — do NOT call them eliminated or suggest they need to win to survive.
- Status "QUALIFIED": they are through — celebrate or comment accordingly.
THE STANDINGS ABOVE ALREADY INCLUDE TODAY'S MATCH RESULTS. Do NOT re-add today's match points to compute standings — they are already applied. Trust the COMPUTED ADVANCEMENT STATUS exactly.
VIOLATING THESE RULES (e.g. calling an IN CONTENTION or NEEDS POINTS team eliminated or saying they "must win or go home") is your single biggest failure mode. Do not do it.\n` : ''}
MATCH DETAILS FOR TODAY (${targetDate}):
${dayMatchesList}

${completedMatchesForRecap.length > 0 ? `
COMPLETED MATCH TIMELINES & STATS:
${completedMatchesForRecap.map(m => `
- Match: ${m.homeTeam} vs ${m.awayTeam}
  Events Timeline: ${JSON.stringify(m.events)}
  Match Stats: ${JSON.stringify(m.stats)}
`).join('\n')}

PLAYERS WHO PLAYED TODAY AND THEIR STATS:
${playersListStr}
` : ''}

For each completed match:
- "matches" key: An ARRAY of objects, one per completed match. Each object must include matchKey (e.g. "NED-SWE"), editionTitle, snappySummary, talkingPoints (array of strings), randomQuirk.
- "teams" key: An ARRAY of objects, one per team that played. Each object must include teamCode (e.g. "NED"), headline, storySoFar, whatsNext, pubAmmo. For "whatsNext", you MUST reflect the team's COMPUTED ADVANCEMENT STATUS — do not say "must win or go home" for any team that is not status ELIMINATED.

${playersWhoPlayed.length > 0 ? `
For the "playerVerdicts" key:
- An ARRAY of objects, one per player. Each object must have id (the player's ESPN ID as a string) and verdict (a witty, short, one-sentence pundit verdict/roast based on their stats). Be extremely sarcastic, funny, or celebratory depending on how they performed. For example:
  - If a player scored or assisted: praise them with witty pundit lines.
  - If a player got a red card or a yellow: roast their lack of discipline.
  - If a player had 0 goals/assists/shots/saves despite playing 90 minutes: mock them for getting a cardio session in.
  - If a goalkeeper made many saves: praise their heroic brick wall, or mock their defense.
- REFER to the actual statistics provided (e.g. their goals, assists, saves, cards) inside your witty verdict to anchor it to reality!
` : ''}

For the "day" key:
- If matches on ${targetDate} are completed (Status is STATUS_FINAL or STATUS_FULL_TIME), generate a **daily recap**:
  - headline: A funny, clickbait headline summarizing the day's events.
  - theDrama: A short description of the main talking points, upsets, or funny moments.
  - mustWatchHighlights: Recommending which match was the must-watch, and warning about which matches were absolute sleepfests.
  - progressionNews: Summarize advancement based ONLY on the COMPUTED ADVANCEMENT STATUS above. Only use "going home" / "eliminated" language for teams whose computed status is ELIMINATED. For all others, describe their situation accurately (in contention, needs a result, waiting on other groups, etc.).
- If matches on ${targetDate} are scheduled/upcoming (Status is STATUS_SCHEDULED), generate a **daily preview build-up** (do not mention final scores or results, as the games have not been played yet!):
  - headline: A hype-building, witty headline looking forward to the day's slate.
  - theDrama: A funny preview of the storylines and hype surrounding the day's matches.
  - mustWatchHighlights: Recommend which matches are the absolute must-watch blockbusters and which ones look like boring stalemates.
  - progressionNews: What is at stake for the teams involved (e.g., who must win to survive).

${tomorrowEvents.length > 0 ? `
UPCOMING MATCHES TOMORROW:
${tomorrowMatchesList}

- "today_preview" key: Generate a preview for tomorrow's fixtures with headline, theBigOnes, playersToWatch.
` : ''}

CRITICAL GROUNDING RULES:
1. ONLY discuss matches, events, and opponents explicitly listed in the MATCH DETAILS and COMPLETED MATCH TIMELINES for today (${targetDate}). Do NOT invent other matches, scores, goalscorers, or opponents.
2. Rely 100% on the COMPUTED ADVANCEMENT STATUS for progressionNews and teams' whatsNext fields. Do not say any team is qualified or eliminated if their status is "IN CONTENTION" or "NEEDS POINTS".
3. For teams' "storySoFar" field, only summarize matches that have actually been played by them in the database so far. Do not invent any additional fixtures.
4. Do not mention penalty shootouts unless they are explicitly recorded in the match events timeline.

Adhere strictly to your British pundit persona: sarcastic, self-deprecating, and brutally honest. Keep all commentary grounded in the actual facts provided.

YOU MUST RETURN A RAW JSON OBJECT THAT MATCHES THIS EXACT SCHEMA SPECIFICATION. DO NOT INVENT DYNAMIC KEYS FOR MATCHES OR PLAYERS. USE ARRAYS.

{
  "matches": [
    {
      "matchKey": "string (e.g. TUN-JPN)",
      "editionTitle": "string",
      "snappySummary": "string",
      "talkingPoints": ["string"],
      "randomQuirk": "string"
    }
  ],
  "teams": [
    {
      "teamCode": "string (e.g. TUN)",
      "headline": "string",
      "storySoFar": "string",
      "whatsNext": "string",
      "pubAmmo": "string"
    }
  ],
  "playerVerdicts": [
    {
      "playerId": "string",
      "verdict": "string"
    }
  ],
  "day": {
    "headline": "string",
    "theDrama": "string",
    "mustWatchHighlights": "string",
    "progressionNews": "string"
  },
  "today_preview": {
    "headline": "string",
    "theBigOnes": "string",
    "playersToWatch": "string"
  }
}
`;

    try {
      const response = await callGemini(prompt, responseSchema);
      console.log("✅ Consolidated Gen AI analysis completed successfully.");

      // Parse matches
      if (response.matches) {
        for (const item of response.matches as any[]) {
          masterDB.matches[item.matchKey] = item;
          matchesCSVRows.push([
            item.matchKey,
            item.editionTitle,
            item.snappySummary,
            item.talkingPoints.join(';'),
            item.randomQuirk
          ]);
        }
      }

      // Parse teams
      if (response.teams) {
        for (const item of response.teams as any[]) {
          masterDB.teams[item.teamCode] = item;
          teamsCSVRows.push([
            item.teamCode,
            item.headline,
            item.storySoFar,
            item.whatsNext,
            item.pubAmmo
          ]);
        }
      }

      // Parse daily recap
      if (response.day) {
        masterDB.days[targetDate] = response.day;
        const daysCSVRows = [[
          targetDate,
          response.day.headline,
          response.day.theDrama,
          response.day.mustWatchHighlights,
          response.day.progressionNews
        ]];
        const csvDir = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'csv');
        if (!fs.existsSync(csvDir)) {
          fs.mkdirSync(csvDir, { recursive: true });
        }
        updateCSVFile(
          path.join(csvDir, 'days_ai.csv'),
          ['date', 'headline', 'theDrama', 'mustWatchHighlights', 'progressionNews'],
          0,
          daysCSVRows
        );
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
      }

      // Parse player verdicts
      if (response.playerVerdicts) {
        const verdictsPath = path.resolve(__dirname, '..', 'data', 'player-verdicts.json');
        let existingVerdicts: Record<string, string> = {};
        if (fs.existsSync(verdictsPath)) {
          try {
            existingVerdicts = JSON.parse(fs.readFileSync(verdictsPath, 'utf-8'));
          } catch {}
        }
        
        for (const item of response.playerVerdicts as any[]) {
          existingVerdicts[item.playerId] = item.verdict;
        }

        fs.writeFileSync(verdictsPath, JSON.stringify(existingVerdicts, null, 2), 'utf-8');
        console.log(`🎉 data/player-verdicts.json updated with ${(response.playerVerdicts as any[]).length} player verdicts.`);
      }

      // Parse today_preview
      if (response.today_preview) {
        masterDB.today_preview = {
          headline: response.today_preview.headline,
          theBigOnes: response.today_preview.theBigOnes,
          playersToWatch: response.today_preview.playersToWatch,
          firstKickoffTime: firstKickoffTime
        };
      }
    } catch (err) {
      console.error("❌ Consolidated Gemini request failed:", err);
      throw err; // Re-throw to ensure pipeline logs are updated
    }
  }

  // 6. Ingest Live Group Standings from ESPN
  console.log(`🛡️ Fetching real group standings from ESPN...`);
  try {
    const standingsUrl = `https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings`;
    const standingsData = await fetchJSON(standingsUrl);
    
    const parsedStandings: any[] = [];
    const groups = standingsData.children || [];
    
    for (const group of groups) {
      const groupName = group.name || group.displayName || '';
      const entries = group.standings?.entries || [];
      const teamsList = entries.map((entry: any) => {
        const stats = entry.stats || [];
        const getVal = (name: string) => {
          const s = stats.find((x: any) => x.name === name);
          return s ? Number(s.value) : 0;
        };

        return {
          code: entry.team?.abbreviation || '',
          name: entry.team?.displayName || '',
          mp: getVal('gamesPlayed'),
          w: getVal('wins'),
          d: getVal('ties'),
          l: getVal('losses'),
          gf: getVal('goalsFor'),
          ga: getVal('goalsAgainst'),
          pts: getVal('points')
        };
      });

      parsedStandings.push({
        group: groupName,
        teams: teamsList
      });
    }

    masterDB.espnStandings = parsedStandings;
    console.log(`✅ Standings loaded successfully for ${parsedStandings.length} groups.`);
  } catch (err) {
    console.error(`❌ Failed to fetch standings:`, err);
  }

  // Update last updated timestamp
  masterDB.lastUpdated = new Date().toISOString();

  // 7. Write changes to master JSON
  fs.writeFileSync(masterPath, JSON.stringify(masterDB, null, 2), 'utf-8');
  console.log(`🎉 Master JSON database successfully synchronized at ${masterPath}`);

  // 8. Write/Append changes to CSV files
  const csvDir = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'csv');
  if (!fs.existsSync(csvDir)) {
    fs.mkdirSync(csvDir, { recursive: true });
  }

  if (teamsCSVRows.length > 0) {
    updateCSVFile(
      path.join(csvDir, 'teams_ai.csv'),
      ['teamId', 'headline', 'storySoFar', 'whatsNext', 'pubAmmo'],
      0,
      teamsCSVRows
    );
  }

  if (matchesCSVRows.length > 0) {
    updateCSVFile(
      path.join(csvDir, 'matches_ai.csv'),
      ['matchId', 'editionTitle', 'snappySummary', 'talkingPoints', 'randomQuirk'],
      0,
      matchesCSVRows
    );
  }

  console.log(`🎉 Master CSV tables successfully updated.`);
}

main().catch(err => {
  console.error("❌ Critical Pipeline Crash:", err);
  process.exit(1);
});
