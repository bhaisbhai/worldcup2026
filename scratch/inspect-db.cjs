const fs = require('fs');
const path = require('path');

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
if (!fs.existsSync(masterPath)) {
  console.error("❌ master JSON does not exist!");
  process.exit(1);
}

const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
const espnMatches = masterDB.espnMatches || {};

console.log("=== MATCH HISTORY BY TEAM ===");
const teamHistory = {};
for (const date of Object.keys(espnMatches).sort()) {
  for (const match of espnMatches[date] || []) {
    const isCompleted = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FULL_TIME';
    if (!isCompleted) continue;
    
    const h = match.homeTeam;
    const a = match.awayTeam;
    if (!teamHistory[h]) teamHistory[h] = [];
    if (!teamHistory[a]) teamHistory[a] = [];
    
    teamHistory[h].push({ date, opp: a, role: 'home', score: `${match.homeScore}-${match.awayScore}`, status: match.status });
    teamHistory[a].push({ date, opp: h, role: 'away', score: `${match.homeScore}-${match.awayScore}`, status: match.status });
  }
}

for (const team of Object.keys(teamHistory).sort()) {
  console.log(`\nTeam: ${team}`);
  for (const m of teamHistory[team]) {
    console.log(`  - [${m.date}] vs ${m.opp} (${m.role}): ${m.score} (${m.status})`);
  }
}
