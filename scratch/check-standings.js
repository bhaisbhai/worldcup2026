import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
const espnMatches = master.espnMatches || {};

console.log('Group D matches:');
for (const date of Object.keys(espnMatches).sort()) {
  for (const m of espnMatches[date] || []) {
    if (m.homeTeam === 'USA' || m.awayTeam === 'USA' || m.homeTeam === 'AUS' || m.awayTeam === 'AUS' || m.homeTeam === 'PAR' || m.awayTeam === 'PAR' || m.homeTeam === 'TUR' || m.awayTeam === 'TUR') {
      console.log(`  ${date}: ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam} (${m.status})`);
    }
  }
}
