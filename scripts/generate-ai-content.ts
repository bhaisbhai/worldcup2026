import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

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
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🤖 Requesting Gemini (attempt ${attempt}/${retries})...`);
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          systemInstruction: punditSystemInstruction,
          temperature: 0.4,
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
        throw error; // Propagate fatal errors on last attempt
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

  // 1. Fetch live matches from ESPN Scoreboard API
  const formattedDate = targetDate.replace(/-/g, '');
  const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${formattedDate}`;
  const scoreboardData = await fetchJSON(scoreboardUrl);

  const events = scoreboardData.events || [];
  if (events.length === 0) {
    console.warn(`⚠️ No matches found in ESPN Scoreboard for date ${targetDate}.`);
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

  // Clear or initialize today's real match list
  masterDB.espnMatches[targetDate] = [];

  const matchesCSVRows: string[][] = [];
  const teamsCSVRows: string[][] = [];
  const completedMatchesForRecap: any[] = [];

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
      awayRedCards: Number(getStat(awayStatsList, 'redCards'))
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
    }
  }

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
  if (completedMatchesForRecap.length > 0 || tomorrowEvents.length > 0) {
    console.log(`🤖 Building consolidated Gemini analysis for ${completedMatchesForRecap.length} completed matches and tomorrow's preview...`);

    const matchesProperties: Record<string, any> = {};
    const teamsProperties: Record<string, any> = {};

    for (const match of completedMatchesForRecap) {
      const key = `${match.homeTeam}-${match.awayTeam}`;
      matchesProperties[key] = {
        type: "OBJECT",
        properties: {
          editionTitle: { type: "STRING" },
          snappySummary: { type: "STRING" },
          talkingPoints: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          randomQuirk: { type: "STRING" }
        },
        required: ["editionTitle", "snappySummary", "talkingPoints", "randomQuirk"]
      };

      for (const code of [match.homeTeam, match.awayTeam]) {
        teamsProperties[code] = {
          type: "OBJECT",
          properties: {
            headline: { type: "STRING" },
            storySoFar: { type: "STRING" },
            whatsNext: { type: "STRING" },
            pubAmmo: { type: "STRING" }
          },
          required: ["headline", "storySoFar", "whatsNext", "pubAmmo"]
        };
      }
    }

    const responseSchema: any = {
      type: "OBJECT",
      properties: {},
      required: []
    };

    if (completedMatchesForRecap.length > 0) {
      responseSchema.properties.matches = {
        type: "OBJECT",
        properties: matchesProperties,
        required: Object.keys(matchesProperties)
      };
      responseSchema.properties.teams = {
        type: "OBJECT",
        properties: teamsProperties,
        required: Object.keys(teamsProperties)
      };
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
      responseSchema.required.push("matches", "teams", "day");
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

    const prompt = `
You are analyzing World Cup 2026 matches for date ${targetDate}.

${completedMatchesForRecap.length > 0 ? `
COMPLETED MATCHES TODAY:
${completedMatchesForRecap.map(m => `
- Match: ${m.homeTeam} vs ${m.awayTeam} (${m.homeScore} - ${m.awayScore})
  Stadium: ${m.stadium}
  Events Timeline: ${JSON.stringify(m.events)}
  Match Stats: ${JSON.stringify(m.stats)}
`).join('\n')}

For each completed match:
- "matches" key: Generate commentary under the match key (e.g. "NED-SWE") with editionTitle, snappySummary, talkingPoints, randomQuirk.
- "teams" key: Generate updated tournament summary under the team code keys (e.g. "NED", "SWE") with headline, storySoFar, whatsNext, pubAmmo.
- "day" key: Generate a daily summary recap with headline, theDrama, mustWatchHighlights, progressionNews.
` : ''}

${tomorrowEvents.length > 0 ? `
UPCOMING MATCHES TOMORROW:
${tomorrowMatchesList}

- "today_preview" key: Generate a preview for tomorrow's fixtures with headline, theBigOnes, playersToWatch.
` : ''}

Adhere strictly to your British pundit persona: sarcastic, self-deprecating, and brutally honest. Keep all commentary grounded in the actual facts provided in the completed matches list.
`;

    try {
      const response = await callGemini(prompt, responseSchema);
      console.log("✅ Consolidated Gen AI analysis completed successfully.");

      // Parse matches
      if (response.matches) {
        for (const [key, matchAnalysis] of Object.entries(response.matches as Record<string, any>)) {
          masterDB.matches[key] = matchAnalysis;
          matchesCSVRows.push([
            key,
            matchAnalysis.editionTitle,
            matchAnalysis.snappySummary,
            matchAnalysis.talkingPoints.join(';'),
            matchAnalysis.randomQuirk
          ]);
        }
      }

      // Parse teams
      if (response.teams) {
        for (const [code, teamAnalysis] of Object.entries(response.teams as Record<string, any>)) {
          masterDB.teams[code] = teamAnalysis;
          teamsCSVRows.push([
            code,
            teamAnalysis.headline,
            teamAnalysis.storySoFar,
            teamAnalysis.whatsNext,
            teamAnalysis.pubAmmo
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
      const groupName = group.displayName || '';
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
