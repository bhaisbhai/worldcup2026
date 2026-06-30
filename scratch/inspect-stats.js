import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
  if (!fs.existsSync(masterPath)) {
    console.error("ai_master.json not found");
    return;
  }
  const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  const targetDate = '2026-06-20';
  const matches = masterDB.espnMatches[targetDate] || [];
  console.log(`Matches on ${targetDate}:`, matches.map(m => `${m.homeTeam} vs ${m.awayTeam} (ID: ${m.id})`));

  if (matches.length > 0) {
    const eventId = matches[0].id;
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
    console.log(`Fetching summary for event ${eventId}: ${url}`);
    const res = await fetch(url);
    const data = await res.json();
    
    console.log("Top level keys of summary API response:", Object.keys(data));
    if (data.boxscore) {
      console.log("Boxscore keys:", Object.keys(data.boxscore));
      if (data.boxscore.players) {
        console.log("boxscore.players format (first item):", JSON.stringify(data.boxscore.players[0], null, 2));
      }
    }
  }
}

main();
