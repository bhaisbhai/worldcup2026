import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';
  const res = await fetch(url);
  const data = await res.json();
  const groups = data.children || [];
  console.log('Groups returned:', groups.length);
  if (groups.length > 0) {
    console.log('First group keys:', Object.keys(groups[0]));
    console.log('First group name/displayName:', groups[0].name, '/', groups[0].displayName);
  }
}

main().catch(console.error);
