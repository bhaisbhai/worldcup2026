import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

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
  const dates = Object.keys(espnMatches).sort();

  console.log(`📅 Found ${dates.length} match days to analyze: ${dates.join(', ')}`);

  const dailyMatchesDetails: Record<string, string> = {};
  const properties: Record<string, any> = {};

  for (const date of dates) {
    const matches = espnMatches[date] || [];
    if (matches.length === 0) continue;

    dailyMatchesDetails[date] = matches.map((m: any) => 
      `- Match: ${m.homeTeam} vs ${m.awayTeam} (${m.homeScore}-${m.awayScore}), Stadium: ${m.stadium}, Stats: ${JSON.stringify(m.stats)}`
    ).join('\n');

    properties[date] = {
      type: "OBJECT",
      properties: {
        headline: { type: "STRING" },
        theDrama: { type: "STRING" },
        mustWatchHighlights: { type: "STRING" },
        progressionNews: { type: "STRING" }
      },
      required: ["headline", "theDrama", "mustWatchHighlights", "progressionNews"]
    };
  }

  const responseSchema = {
    type: "OBJECT",
    properties,
    required: Object.keys(properties)
  };

  const prompt = `
You are analyzing World Cup 2026 match days. For each date, generate a daily recap.

MATCH DETAILS BY DATE:
${Object.entries(dailyMatchesDetails).map(([date, details]) => `
DATE: ${date}
${details}
`).join('\n')}

For each date key in the schema, provide:
- headline: A funny, clickbait headline summarizing the day's events.
- theDrama: A short description of the main talking points, upsets, or funny moments.
- mustWatchHighlights: Recommending which match was the must-watch, and warning about which matches were absolute sleepfests.
- progressionNews: Summarize who is progressing to the knockouts, who is booking flights home, or who is in danger.

Adhere strictly to your British football pundit co-host persona: sarcastic, self-deprecating, and brutally honest. Ground every single claim in the matches and scores provided. Do not hallucinate or invent new matches.
`;

  console.log("🤖 Requesting consolidated daily recaps from Gemini...");
  const response = await callGemini(prompt, responseSchema);
  console.log("✅ Consolidated summaries generated successfully.");

  // Save to master JSON
  masterDB.days = masterDB.days || {};
  const daysCSVRows: string[][] = [];

  for (const date of Object.keys(response)) {
    masterDB.days[date] = response[date];
    daysCSVRows.push([
      date,
      response[date].headline,
      response[date].theDrama,
      response[date].mustWatchHighlights,
      response[date].progressionNews
    ]);
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
