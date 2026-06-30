import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scratch/standings_live.json', 'utf8'));

data.children[0].standings.entries.forEach(entry => {
  console.log(`Team: ${entry.team.displayName}`);
  entry.stats.forEach(s => {
    if (['points', 'gamesPlayed', 'wins', 'ties', 'losses', 'pointDifferential', 'pointsFor', 'pointsAgainst'].includes(s.name)) {
      console.log(`  ${s.name}: ${s.value}`);
    }
  });
});
