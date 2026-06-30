const fs = require('fs');
const path = require('path');

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
if (!fs.existsSync(masterPath)) {
  console.error("❌ master JSON does not exist!");
  process.exit(1);
}

const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
const espnMatches = masterDB.espnMatches || {};
const matches = masterDB.matches || {};

// Gather all completed match keys from ESPN (homeTeam-awayTeam)
const completedKeys = new Set();
for (const date of Object.keys(espnMatches)) {
  for (const m of espnMatches[date] || []) {
    const isCompleted = m.status === 'STATUS_FINAL' || m.status === 'STATUS_FULL_TIME';
    if (!isCompleted) continue;
    completedKeys.add(`${m.homeTeam}-${m.awayTeam}`);
  }
}

console.log(`🔍 Total completed match keys in ESPN data: ${completedKeys.size}`);

// Find stale keys in masterDB.matches
const staleKeys = [];
for (const key of Object.keys(matches)) {
  if (!completedKeys.has(key)) {
    staleKeys.push(key);
  }
}

console.log(`🧹 Found ${staleKeys.length} stale match summaries in master DB:`, staleKeys);

if (staleKeys.length > 0) {
  for (const key of staleKeys) {
    delete masterDB.matches[key];
  }
  
  // Save updated JSON
  fs.writeFileSync(masterPath, JSON.stringify(masterDB, null, 2), 'utf-8');
  console.log(`✅ Cleaned up ${staleKeys.length} stale match summaries in ${masterPath}.`);
  
  // Re-write CSV files to match
  function stringifyCSVRow(arr) {
    return arr.map(val => {
      const escaped = val.replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',');
  }

  const matchesCSVRows = [];
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
  console.log(`🎉 Matches CSV table successfully updated at ${csvPath}`);

  fs.writeFileSync(dataCsvPath, csvContent, 'utf-8');
  console.log(`🎉 Matches CSV table successfully updated at ${dataCsvPath}`);
} else {
  console.log(`✅ No stale match summaries found.`);
}
