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
2. FACTUAL ANCHORING: Every roast, criticism, or praise must be anchored directly to the actual match scores and statistics provided.
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
  
  // Collect all completed matches and group them by team
  const teamMatchHistory: Record<string, any[]> = {};
  const teamNames: Record<string, string> = {};

  for (const date of Object.keys(espnMatches)) {
    for (const match of espnMatches[date] || []) {
      const isCompleted = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FULL_TIME';
      if (!isCompleted) continue;

      const homeCode = match.homeTeam;
      const awayCode = match.awayTeam;

      if (!teamMatchHistory[homeCode]) teamMatchHistory[homeCode] = [];
      if (!teamMatchHistory[awayCode]) teamMatchHistory[awayCode] = [];

      teamMatchHistory[homeCode].push(match);
      teamMatchHistory[awayCode].push(match);
    }
  }

  // Look up team full names from the roster/players data if possible, or default
  // Let's populate teamNames from the stats data
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

  const teamCodes = Object.keys(teamMatchHistory).sort();
  console.log(`📅 Found ${teamCodes.length} teams that have played completed matches: ${teamCodes.join(', ')}`);

  masterDB.teams = masterDB.teams || {};

  // Batch process teams (3 teams per batch)
  const batchSize = 3;
  for (let i = 0; i < teamCodes.length; i += batchSize) {
    const batch = teamCodes.slice(i, i + batchSize);
    console.log(`\n📦 Processing batch: ${batch.join(', ')} (${i + 1} to ${Math.min(i + batchSize, teamCodes.length)} of ${teamCodes.length})...`);

    // Build the details string for this batch of teams
    let teamsDetailsStr = '';
    const schemaProperties: Record<string, any> = {};
    const schemaRequired: string[] = [];

    for (const code of batch) {
      const name = teamNames[code] || code;
      const history = teamMatchHistory[code] || [];
      const matchesStr = history.map(m => {
        const isHome = m.homeTeam === code;
        const result = isHome 
          ? (m.homeScore > m.awayScore ? 'W' : (m.homeScore === m.awayScore ? 'D' : 'L'))
          : (m.awayScore > m.homeScore ? 'W' : (m.homeScore === m.awayScore ? 'D' : 'L'));
        const score = `${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`;
        return `- ${score} (${result}), Stadium: ${m.stadium}, Events: ${JSON.stringify(m.events)}`;
      }).join('\n');

      teamsDetailsStr += `
TEAM CODE: ${code} (${name})
MATCHES PLAYED:
${matchesStr}
`;

      schemaProperties[code] = {
        type: "OBJECT",
        properties: {
          headline: { type: "STRING" },
          storySoFar: { type: "STRING" },
          whatsNext: { type: "STRING" },
          pubAmmo: { type: "STRING" }
        },
        required: ["headline", "storySoFar", "whatsNext", "pubAmmo"]
      };
      schemaRequired.push(code);
    }

    const prompt = `
Generate witty, pundit-style team summaries for these World Cup 2026 teams:

TEAM DETAILS:
${teamsDetailsStr}

For each team code key in the schema, provide:
- headline: A funny, clickbait headline summarizing their tournament journey.
- storySoFar: A witty co-host commentary on their matches, style of play, and results.
- whatsNext: What they need to do in upcoming fixtures and their outlook.
- pubAmmo: A fun, factual piece of trivia or stat derived from their actual matches (e.g. "Did you know they managed 0 shots on target despite 70% possession?").

CRITICAL GROUNDING RULES:
1. ONLY discuss matches and opponents explicitly listed in the "MATCHES PLAYED" section for each team. Do NOT invent other opponents or matches. If a team's only match is against Croatia (CRO), do NOT mention Denmark (DEN) or any other opponent.
2. Count the matches in the "MATCHES PLAYED" section. Do not say they have played 3 matches if only 1 or 2 are listed. Only comment on the matches listed.
3. Do NOT mention penalty shootouts unless there is a penalty shootout recorded in the match events. Group stage games cannot go to penalties.
4. Keep all stories, comments, and trivia strictly aligned with the scores and events provided. Do not invent scores, goalscorers, or stats.

Adhere strictly to your British football co-host persona: sarcastic, humorous, and opinionated. Keep all commentary grounded in the actual scores and events provided.
`;

    const responseSchema = {
      type: "OBJECT",
      properties: schemaProperties,
      required: schemaRequired
    };

    const response = await callGemini(prompt, responseSchema);
    console.log(`✅ Batch processed successfully.`);

    // Merge into master DB
    for (const code of batch) {
      if (response[code]) {
        masterDB.teams[code] = response[code];
      }
    }

    await sleep(2000); // 2s delay between batches
  }

  // Write Master JSON
  fs.writeFileSync(masterPath, JSON.stringify(masterDB, null, 2), 'utf-8');
  console.log(`\n🎉 Master JSON updated successfully with team summaries.`);

  // Write CSV
  const teamsCSVRows: string[][] = [];
  for (const code of Object.keys(masterDB.teams).sort()) {
    const t = masterDB.teams[code];
    teamsCSVRows.push([
      code,
      t.headline,
      t.storySoFar,
      t.whatsNext,
      t.pubAmmo
    ]);
  }

  const csvPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'csv', 'teams_ai.csv');
  const dataCsvPath = path.resolve(__dirname, '..', 'data', 'teams_ai.csv');
  const headers = ['teamId', 'headline', 'storySoFar', 'whatsNext', 'pubAmmo'];
  
  const finalCSVRows = [headers, ...teamsCSVRows];
  const csvContent = finalCSVRows.map(r => stringifyCSVRow(r)).join('\n') + '\n';

  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`🎉 Teams CSV table successfully written to ${csvPath}`);

  fs.writeFileSync(dataCsvPath, csvContent, 'utf-8');
  console.log(`🎉 Teams CSV table successfully written to ${dataCsvPath}`);
}

main().catch(err => {
  console.error("❌ Retrospective team summary generation failed:", err);
});
