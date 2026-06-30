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
  
  const allStatNames = new Map();

  for (const match of matches) {
    const eventId = match.id;
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.rosters) {
      for (const team of data.rosters) {
        for (const player of team.roster || []) {
          for (const stat of player.stats || []) {
            if (!allStatNames.has(stat.name)) {
              allStatNames.set(stat.name, {
                displayName: stat.displayName,
                shortDisplayName: stat.shortDisplayName,
                abbreviation: stat.abbreviation,
                sampleValue: stat.value,
                sampleDisplayValue: stat.displayValue
              });
            }
          }
        }
      }
    }
  }

  console.log("ALL UNIQUE PLAYER STATS FOUND IN ESPN ROSTER DATA:");
  for (const [name, info] of allStatNames.entries()) {
    console.log(`- ${name} (${info.displayName}): short=${info.shortDisplayName}, abbr=${info.abbreviation}, sample=${info.sampleValue} (display: ${info.sampleDisplayValue})`);
  }
}

main();
