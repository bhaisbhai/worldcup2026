import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scratch/standings_live.json', 'utf8'));

(data.children || []).forEach(child => {
  console.log(`\n=== ${child.name} ===`);
  (child.standings?.entries || []).forEach(entry => {
    const stats = entry.stats || [];
    const getStat = (name) => {
      const s = stats.find(x => x.name === name || x.shortDisplayName === name);
      return s ? s.value : 0;
    };
    const note = entry.note?.description || 'none';
    console.log(`- ${entry.team?.displayName} (${entry.team?.abbreviation}): P=${getStat('gamesPlayed')}, W=${getStat('wins')}, D=${getStat('ties')}, L=${getStat('losses')}, GD=${getStat('pointsFor') - getStat('pointsAgainst')}, PTS=${getStat('points')}, Note: "${note}"`);
  });
});
