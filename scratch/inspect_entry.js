import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scratch/standings_live.json', 'utf8'));

const entry = data.children[0].standings.entries[0];
console.log(JSON.stringify(entry, null, 2));
