const fs = require('fs');
const path = require('path');

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));

console.log("=========================================");
console.log("        MANUAL VERIFICATION LIST        ");
console.log("=========================================");

const targetTeams = ["ENG", "GER", "USA", "CRO"];
for (const code of targetTeams) {
  const t = masterDB.teams[code];
  console.log(`\n--- TEAM: ${code} ---`);
  if (!t) {
    console.log("Not found!");
    continue;
  }
  console.log(`Headline: ${t.headline}`);
  console.log(`Story So Far: ${t.storySoFar}`);
  console.log(`What's Next: ${t.whatsNext}`);
  console.log(`Pub Ammo: ${t.pubAmmo}`);
}

const targetDays = ["2026-06-21", "2026-06-22"];
for (const date of targetDays) {
  const d = masterDB.days[date];
  console.log(`\n--- DAY: ${date} ---`);
  if (!d) {
    console.log("Not found!");
    continue;
  }
  console.log(`Headline: ${d.headline}`);
  console.log(`The Drama: ${d.theDrama}`);
  console.log(`Highlights: ${d.mustWatchHighlights}`);
  console.log(`Progression: ${d.progressionNews}`);
}
