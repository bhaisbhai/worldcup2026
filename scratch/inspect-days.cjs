const fs = require('fs');
const path = require('path');

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
if (!fs.existsSync(masterPath)) {
  console.error("❌ master JSON does not exist!");
  process.exit(1);
}

const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
const days = masterDB.days || {};

console.log("=== DAILY SUMMARIES ===");
for (const date of Object.keys(days).sort()) {
  console.log(`\nDate: ${date}`);
  console.log(`  Headline: ${days[date].headline}`);
  console.log(`  Drama: ${days[date].theDrama}`);
  console.log(`  Highlights: ${days[date].mustWatchHighlights}`);
  console.log(`  Progression: ${days[date].progressionNews}`);
}
