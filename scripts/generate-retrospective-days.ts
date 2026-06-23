import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const punditSystemInstruction = `
You are a witty, highly-opinionated British football pundit and the co-host of a popular football podcast. Your tone is sharp, funny, and heavily reliant on classic British football banter and dark humor.

Tone Rules:
- Maximize sarcasm, self-deprecation, and cheeky roasts of poor performances.
- Use classic British football terminology (e.g., "Sunday League defending", "liquid football", "walking cheat code", "completely bottled it", "squeaky bum time", "put your feet up", "absolute scenes", "having a casual kickabout in the park").
- STRICTLY AVOID modern South London / MLE (Multicultural London English) slang. Do NOT use words like "bruv", "handbags", "fam", "peng", "innit", or "allow it". 
- Keep the humor sharp and witty, but never cross the line into genuinely toxic, offensive, or abusive language.
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGemini(prompt: string, schema: any, retries = 10): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🤖 Requesting Gemini (attempt ${attempt}/${retries})...`);
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          systemInstruction: punditSystemInstruction,
          temperature: 0.1,
        },
      });

      if (!response.text) {
        throw new Error("Empty response from Gemini API");
      }

      return JSON.parse(response.text);
    } catch (error: any) {
      const errMsg = error.message || "";
      const is503 = errMsg.includes("503") || 
                    errMsg.toLowerCase().includes("service unavailable") ||
                    errMsg.toLowerCase().includes("overloaded");
      const isRateLimit = errMsg.includes("429") || 
                          errMsg.toLowerCase().includes("quota");

      if (attempt < retries) {
        if (is503) {
          console.warn("⚠️ 503 Service Unavailable detected. Entering 30-second (30,000ms) cooldown block before retrying...");
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
        throw error;
      }
    }
  }
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

function stringifyCSVRow(arr: string[]): string {
  return arr.map(val => {
    const escaped = val.replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(',');
}

async function main() {
  const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
  if (!fs.existsSync(masterPath)) {
    console.error("❌ master JSON does not exist!");
    return;
  }

  const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  const espnMatches = masterDB.espnMatches || {};
  const dates = Object.keys(espnMatches).sort();

  console.log(`📅 Found ${dates.length} match days to analyze: ${dates.join(', ')}`);

  masterDB.days = masterDB.days || {};
  const daysCSVRows: string[][] = [];

  const schema = {
    type: "OBJECT",
    properties: {
      headline: { type: "STRING" },
      theDrama: { type: "STRING" },
      mustWatchHighlights: { type: "STRING" },
      progressionNews: { type: "STRING" }
    },
    required: ["headline", "theDrama", "mustWatchHighlights", "progressionNews"]
  };

  for (const date of dates) {
    const matches = espnMatches[date] || [];
    if (matches.length === 0) continue;

    console.log(`\n🤖 Processing date retrospective summary for: ${date}...`);

    const dailyMatchesStr = matches.map((m: any) => 
      `- Match: ${m.homeTeam} vs ${m.awayTeam} (Score: ${m.homeScore}-${m.awayScore}) [Status: ${m.status}], Stadium: ${m.stadium}, Stats: ${JSON.stringify(m.stats)}`
    ).join('\n');

    const computed = computeStandingsAndStatus(masterDB, date);
    const standingsContext = `GROUP STANDINGS (after this date's matches, ${date}):\n${computed.standingsContext}`;
    const advancementStatus = `COMPUTED ADVANCEMENT STATUS (after this date's matches, ${date}):\n${computed.advancementStatus}`;

    const prompt = `
You are analyzing World Cup 2026 match days. Generate a daily summary for the date: ${date}.

WORLD CUP 2026 FORMAT (critical for progression commentary):
- 48 teams in 12 groups of 4. Top 2 from each group qualify automatically (24 teams total).
- Additionally, the 8 BEST 3rd-place teams across all 12 groups also advance — so 8 out of 12 third-place finishers qualify.
- A team finishing 3rd with 4+ points has a realistic shot; 3 points is borderline; 2 points or fewer is almost certainly out.
- DO NOT say a 3rd-place team "might go home" or is eliminated unless their COMPUTED STATUS is explicitly ELIMINATED.

ADVANCEMENT LANGUAGE RULES — YOU MUST FOLLOW THESE EXACTLY for "progressionNews":
- Status "ELIMINATED": you MAY say they are out, going home, booking flights.
- Status "IN CONTENTION": say they are still in the hunt, have games to play, can qualify — do NOT imply they need a miracle or must win to survive.
- Status "NEEDS POINTS": say they need a strong result to keep best-3rd hopes alive — do NOT say they're going home or must win outright to survive.
- Status "POSSIBLE BEST-3RD": say they are in the running for a best-3rd slot, waiting on other groups — do NOT call them eliminated or suggest they need to win to survive.
- Status "QUALIFIED": they are through — celebrate or comment accordingly.
THE STANDINGS PROVIDED FOR THE DATE ALREADY INCLUDE THAT DATE'S MATCH RESULTS. Trust the COMPUTED ADVANCEMENT STATUS exactly.
VIOLATING THESE RULES (e.g. calling an IN CONTENTION or NEEDS POINTS team eliminated or saying they "must win or go home") is your single biggest failure mode. Do not do it.

MATCH DETAILS, STANDINGS & ADVANCEMENT FOR ${date}:
${dailyMatchesStr}

${standingsContext}

${advancementStatus}

Generate a JSON object containing:
- headline: A funny, clickbait headline summarizing the day's events.
- theDrama: A short description of the main talking points, upsets, or funny moments.
- mustWatchHighlights: Recommending which match was the must-watch, and warning about which matches were absolute sleepfests.
- progressionNews: Summarize who is progressing to the knockouts, who is booking flights home, or who is in danger. You MUST base this summary ONLY on the computed Group Advancement Status provided for that day. Do NOT assume, speculate, or hallucinate team progression/elimination that is not explicitly confirmed or supported by the Group Advancement Status.

If matches on this date are completed (Status is STATUS_FINAL or STATUS_FULL_TIME), generate a **daily recap**.
If matches on this date are scheduled/upcoming (Status is STATUS_SCHEDULED), generate a **daily preview build-up** (do not mention final scores or results, as the games have not been played yet!).

CRITICAL GROUNDING RULES:
1. ONLY discuss matches and opponents explicitly listed in the MATCH DETAILS for this date. Do NOT invent other opponents or matches.
2. Rely 100% on the COMPUTED ADVANCEMENT STATUS for progressionNews. Do not assume any team is qualified or eliminated if their status is "IN CONTENTION" or "NEEDS POINTS".
3. Check the dates of the matches. Do not mention events from other dates.

Adhere strictly to your British football pundit co-host persona: sarcastic, self-deprecating, and brutally honest. Ground every single claim in the matches and scores provided. Do not hallucinate or invent new matches.
`;

    const response = await callGemini(prompt, schema);
    masterDB.days[date] = response;
    daysCSVRows.push([
      date,
      response.headline,
      response.theDrama,
      response.mustWatchHighlights,
      response.progressionNews
    ]);

    await sleep(2000); // 2s delay between API calls to respect rate limits
  }

  // Write JSON
  fs.writeFileSync(masterPath, JSON.stringify(masterDB, null, 2), 'utf-8');
  console.log(`🎉 Master JSON updated successfully with daily summaries.`);

  // Write CSV
  const csvPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'csv', 'days_ai.csv');
  const headers = ['date', 'headline', 'theDrama', 'mustWatchHighlights', 'progressionNews'];
  
  // Sort rows by date
  daysCSVRows.sort((a, b) => a[0].localeCompare(b[0]));
  
  const finalCSVRows = [headers, ...daysCSVRows];
  const csvContent = finalCSVRows.map(r => stringifyCSVRow(r)).join('\n') + '\n';
  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`🎉 Days CSV table successfully written to ${csvPath}`);
}

main().catch(err => {
  console.error("❌ Retrospective summary generation failed:", err);
});
