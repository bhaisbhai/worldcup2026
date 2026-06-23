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
- Use classic British football terminology (e.g., "Sunday League defending", "liquid football", "walking cheat code", "completely bottled it", "squeaky bum time", "put your feet up", "absolute scenes", "having a casual kickabout in the park", "fox in the box", "proper bottle job").
- STRICTLY AVOID modern South London / MLE (Multicultural London English) slang. Do NOT use words like "bruv", "handbags", "fam", "peng", "innit", or "allow it". 
- Keep the humor sharp and witty, but never cross the line into genuinely toxic, offensive, or abusive language.
- DO NOT write boring, dry, or formal summaries. Write as if you are bantering with a mate down the pub!

Critical Grounding Guardrails (Anti-Hallucination):
1. ZERO HALLUCINATION: Do not invent or estimate scores, match events, or player statistics.
2. FACTUAL ANCHORING: Every roast, criticism, or praise must be anchored directly to the actual match scores and statistics provided. Do not mention players, goals, cards, or incidents unless they are explicitly recorded in the timeline or statistics.
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
      console.error("❌ Gemini API Call Error:", error);
      const errMsg = error.message || "";
      const is503 = errMsg.includes("503") || 
                    errMsg.toLowerCase().includes("service unavailable") ||
                    errMsg.toLowerCase().includes("overloaded");
      const isRateLimit = errMsg.includes("429") || 
                          errMsg.toLowerCase().includes("quota");

      if (attempt < retries) {
        if (is503) {
          console.warn("⚠️ 503 Service Unavailable detected. Cooldown 30s...");
          await sleep(30000);
        } else if (isRateLimit) {
          console.warn("⚠️ 429 Rate Limit hit. Backoff 60s...");
          await sleep(60000);
        } else {
          console.warn(`⚠️ Warning: ${errMsg}. Retrying in 5s...`);
          await sleep(5000);
        }
      } else {
        console.error("❌ Gemini API failed after max retries.");
        throw error;
      }
    }
  }
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
  
  // Collect all completed matches
  const completedMatches: any[] = [];
  const teamNames: Record<string, string> = {};

  for (const date of Object.keys(espnMatches)) {
    for (const match of espnMatches[date] || []) {
      const isCompleted = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FULL_TIME';
      if (isCompleted) {
        completedMatches.push({ ...match, date });
      }
    }
  }

  // Look up team full names from player-stats
  const playerStatsPath = path.resolve(__dirname, '..', 'data', 'player-stats.json');
  if (fs.existsSync(playerStatsPath)) {
    const ps = JSON.parse(fs.readFileSync(playerStatsPath, 'utf-8'));
    for (const id of Object.keys(ps)) {
      const p = ps[id];
      if (p.teamAbbr && p.teamName) {
        teamNames[p.teamAbbr] = p.teamName;
      }
    }
  }

  console.log(`⚽ Found ${completedMatches.length} completed matches to analyze.`);

  masterDB.matches = masterDB.matches || {};

  const schema = {
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

  for (let idx = 0; idx < completedMatches.length; idx++) {
    const match = completedMatches[idx];
    const key = `${match.homeTeam}-${match.awayTeam}`;
    const homeName = teamNames[match.homeTeam] || match.homeTeam;
    const awayName = teamNames[match.awayTeam] || match.awayTeam;

    console.log(`\n📝 Processing Match [${idx + 1}/${completedMatches.length}]: ${key} (${match.date})...`);

    const prompt = `
You are analyzing a completed World Cup 2026 match:
HOME TEAM: ${homeName} (${match.homeTeam})
AWAY TEAM: ${awayName} (${match.awayTeam})
FINAL SCORE: ${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}
STADIUM: ${match.stadium}
MATCH STATS:
- Possession: ${match.stats?.homePossession || '50%'} (Home) vs ${match.stats?.awayPossession || '50%'} (Away)
- Shots: ${match.stats?.homeShots || 0} (Home) vs ${match.stats?.awayShots || 0} (Away)
- Shots on Target: ${match.stats?.homeShotsOnTarget || 0} (Home) vs ${match.stats?.awayShotsOnTarget || 0} (Away)
- Corners: ${match.stats?.homeCorners || 0} (Home) vs ${match.stats?.awayCorners || 0} (Away)
- Yellow Cards: ${match.stats?.homeYellowCards || 0} (Home) vs ${match.stats?.awayYellowCards || 0} (Away)
- Red Cards: ${match.stats?.homeRedCards || 0} (Home) vs ${match.stats?.awayRedCards || 0} (Away)

KEY MATCH EVENTS & TIMELINE:
${match.events && match.events.length > 0 ? match.events.join('\n') : '(No events recorded)'}

Generate a JSON object containing:
- editionTitle: A funny, clickbait headline in ALL CAPS summarizing this match. Keep it concise.
- snappySummary: A witty, pundit-style co-host commentary of the match. It must explicitly state the correct final score, mention major goalscorers, cards, or key highlights, and use classic British football banter.
- talkingPoints: An array of exactly 3 bullet points/facts derived strictly from the match timeline or stats (e.g., when goals were scored, cards, key substitutions, or dominant team stats).
- randomQuirk: A funny, factual observation based ONLY on real events or stats in the timeline (e.g. a player getting booked in the 1st minute, a team managing 0 shots on target despite 70% possession, conceding an own goal, a late winner in the 94th minute). Do NOT invent fictional events (such as fans reading guidebooks upside-down or a player getting kicked in the face by a ball).

CRITICAL GROUNDING RULES:
1. STRICTLY TRUTH: Everything in the summary, talking points, and random quirk must be 100% factually correct based on the provided stats and timeline.
2. DO NOT invent scorelines, goalscorers, cards, or events.
3. DO NOT invent fictional spectator antics or imaginary physical comedy on the pitch. If it's not in the timeline or stats, it did not happen.
4. Sarcasm and banter are encouraged, but must only be used to mock real poor performances or celebrate real brilliant plays.
`;

    const response = await callGemini(prompt, schema);
    
    // Validate talkingPoints count
    if (!Array.isArray(response.talkingPoints) || response.talkingPoints.length !== 3) {
      console.warn("⚠️ talkingPoints did not return exactly 3 items. Adjusting...");
      if (Array.isArray(response.talkingPoints)) {
        response.talkingPoints = response.talkingPoints.slice(0, 3);
        while (response.talkingPoints.length < 3) {
          response.talkingPoints.push("No additional talking point recorded.");
        }
      } else {
        response.talkingPoints = ["Game completed", "No talking points", "Factual summary generated"];
      }
    }

    console.log(`  Title: ${response.editionTitle}`);
    console.log(`  Summary: ${response.snappySummary}`);
    console.log(`  Quirk: ${response.randomQuirk}`);

    masterDB.matches[key] = response;

    // Save progressively to master JSON after each match in case of termination
    fs.writeFileSync(masterPath, JSON.stringify(masterDB, null, 2), 'utf-8');

    await sleep(3000); // 3s delay to stay within rate limit (15 RPM)
  }

  console.log(`\n🎉 All match summaries updated in Master DB.`);

  // Write CSV
  const matchesCSVRows: string[][] = [];
  for (const key of Object.keys(masterDB.matches).sort()) {
    const m = masterDB.matches[key];
    const matchId = key.replace('-', '_');
    matchesCSVRows.push([
      matchId,
      m.editionTitle,
      m.snappySummary,
      m.talkingPoints.join(';'),
      m.randomQuirk
    ]);
  }

  const csvPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'csv', 'matches_ai.csv');
  const dataCsvPath = path.resolve(__dirname, '..', 'data', 'matches_ai.csv');
  const headers = ['matchId', 'editionTitle', 'snappySummary', 'talkingPoints', 'randomQuirk'];
  
  const finalCSVRows = [headers, ...matchesCSVRows];
  const csvContent = finalCSVRows.map(r => stringifyCSVRow(r)).join('\n') + '\n';

  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`🎉 Matches CSV table successfully written to ${csvPath}`);

  fs.writeFileSync(dataCsvPath, csvContent, 'utf-8');
  console.log(`🎉 Matches CSV table successfully written to ${dataCsvPath}`);
}

main().catch(err => {
  console.error("❌ Retrospective match summary generation failed:", err);
});
