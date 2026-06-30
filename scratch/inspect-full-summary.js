import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const eventId = '760447'; // NED vs SWE
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
  console.log(`Fetching summary for event ${eventId}: ${url}`);
  const res = await fetch(url);
  const data = await res.json();
  
  // Write to scratch so we can inspect it if needed
  fs.writeFileSync(
    path.resolve(__dirname, '..', 'scratch', 'match_summary_760447.json'),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
  console.log("Saved full JSON to scratch/match_summary_760447.json");

  // Search function to find all occurrences of keys or values containing keywords
  const keywords = ['clearance', 'pass', 'accuracy', 'tackle', 'intercept', 'block', 'clean', 'sheet'];
  const matches = [];

  function deepSearch(obj, path = '') {
    if (!obj) return;
    if (typeof obj === 'string') {
      for (const kw of keywords) {
        if (obj.toLowerCase().includes(kw)) {
          matches.push({ path, value: obj });
        }
      }
      return;
    }
    if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        for (const kw of keywords) {
          if (key.toLowerCase().includes(kw)) {
            matches.push({ path: `${path}.${key}`, keyMatch: true });
          }
        }
        try {
          deepSearch(obj[key], `${path}.${key}`);
        } catch (e) {}
      }
    }
  }

  deepSearch(data);
  const nonTeamMatches = matches.filter(m => !m.path.includes('.boxscore.teams'));
  console.log(`\nFound ${nonTeamMatches.length} non-team matches for keywords:`, keywords);
  nonTeamMatches.forEach(m => {
    if (m.keyMatch) {
      console.log(`- KEY MATCH: ${m.path}`);
    } else {
      console.log(`- VALUE MATCH: ${m.path} = ${String(m.value).substring(0, 80)}`);
    }
  });
}

main();
