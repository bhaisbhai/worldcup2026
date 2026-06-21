import * as fs from 'fs';
import * as path from 'path';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function extractClub(athlete: any): { club: string; clubLogo: string } {
  // In the national team roster context, athlete.team = their CLUB team
  const t = athlete.team || athlete.athlete?.team || {};
  const club = t.displayName || t.name || '';
  const clubLogo = t.logos?.[0]?.href || t.logo || '';
  return { club, clubLogo };
}

async function main() {
  console.log('⚽ Building player clubs lookup from ESPN rosters...');

  const teamsData = await fetchJSON(
    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams?limit=100'
  );

  const teams: any[] = (teamsData.sports?.[0]?.leagues?.[0]?.teams || []).map((t: any) => t.team || t);
  console.log(`📋 Found ${teams.length} WC2026 teams`);

  const playerClubs: Record<string, { name: string; club: string; teamName: string; teamAbbr: string; position: string; jersey: string; clubLogo?: string }> = {};

  for (const team of teams) {
    const teamId = team.id;
    const teamName = team.displayName || team.name || teamId;
    console.log(`🔍 ${teamName} (id=${teamId})...`);

    try {
      const rosterData = await fetchJSON(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${teamId}/roster`
      );

      // ESPN roster response varies: roster[], athletes[], or items[]
      const athletes: any[] = rosterData.roster || rosterData.athletes || rosterData.items || [];

      let found = 0;
      for (const entry of athletes) {
        const ath = entry.athlete || entry;
        const id = String(ath.id || '');
        if (!id) continue;

        const name = ath.displayName || ath.fullName || '';
        const position = ath.position?.abbreviation || ath.position?.displayName || entry.position?.abbreviation || '';
        const jersey = String(ath.jersey || entry.jersey || '');
        const { club, clubLogo } = extractClub(entry);

        playerClubs[id] = {
          name,
          club,
          teamName: team.displayName || team.name || '',
          teamAbbr: team.abbreviation || '',
          position,
          jersey,
          ...(clubLogo ? { clubLogo } : {}),
        };
        if (club) found++;
      }

      console.log(`  ✅ ${athletes.length} players, ${found} with club data`);
    } catch (err: any) {
      console.warn(`  ⚠️ Failed: ${err.message}`);
    }

    await sleep(400);
  }

  // Second pass: use general (non-WC) ESPN soccer athlete endpoint to get club team
  // The WC endpoint returns no club data — the general endpoint returns primary team = club
  const missing = Object.entries(playerClubs).filter(([, v]) => !v.club);
  if (missing.length > 0) {
    console.log(`\n🔄 Fetching club data for ${missing.length} players via general ESPN athlete endpoint...`);
    let filled = 0;
    for (const [id] of missing) {
      try {
        const profData = await fetchJSON(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/athletes/${id}`
        );
        const ath = profData.athlete || profData || {};
        const { club, clubLogo } = extractClub(ath);
        if (club) { playerClubs[id].club = club; filled++; }
        if (clubLogo) playerClubs[id].clubLogo = clubLogo;
        if (!playerClubs[id].position) playerClubs[id].position = ath.position?.abbreviation || '';
        if (!playerClubs[id].jersey) playerClubs[id].jersey = String(ath.jersey || '');
        await sleep(150);
      } catch {
        // skip silently
      }
    }
    console.log(`  ✅ Found club data for ${filled} players`);
  }

  const total = Object.keys(playerClubs).length;
  const withClub = Object.values(playerClubs).filter(v => v.club).length;
  console.log(`\n📊 ${total} players total, ${withClub} with club data (${Math.round(withClub / total * 100)}%)`);

  const outPath = path.resolve(process.cwd(), 'data', 'player-clubs.json');
  fs.writeFileSync(outPath, JSON.stringify(playerClubs, null, 2), 'utf-8');
  console.log(`🎉 Written to ${outPath}`);
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
