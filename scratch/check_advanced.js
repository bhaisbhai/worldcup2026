import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scratch/standings_live.json', 'utf8'));

(data.children || []).forEach(child => {
  console.log(`\n=== ${child.name} ===`);
  (child.standings?.entries || []).forEach(entry => {
    const stats = entry.stats || [];
    const getStatObj = (name) => stats.find(x => x.name === name || x.shortDisplayName === name);
    const getStat = (name) => {
      const s = getStatObj(name);
      return s ? s.value : 0;
    };
    const advanced = getStat('advanced');
    console.log(`- ${entry.team?.displayName} (${entry.team?.abbreviation}): PTS=${getStat('points')}, ADV=${advanced}`);
  });
});
