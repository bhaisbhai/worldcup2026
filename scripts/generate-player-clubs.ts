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

// TheSportsDB free API — returns strTeam = club (not national team)
async function lookupClubViaSportsDB(name: string): Promise<{ club: string; clubLogo: string }> {
  try {
    const data = await fetchJSON(
      `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(name)}`
    );
    const players: any[] = data.player || [];
    // Pick the soccer match with the best name similarity
    const nameLow = name.toLowerCase();
    const match = players
      .filter(p => {
        const sport = (p.strSport || '').toLowerCase();
        return sport === 'soccer' || sport === 'football';
      })
      .sort((a, b) => {
        // Exact match first, then by name similarity
        const aExact = (a.strPlayer || '').toLowerCase() === nameLow ? 1 : 0;
        const bExact = (b.strPlayer || '').toLowerCase() === nameLow ? 1 : 0;
        return bExact - aExact;
      })[0];

    if (match) {
      return {
        club: match.strTeam || '',
        clubLogo: match.strFanart1 || match.strThumb || '', // SportsDB doesn't have great logos
      };
    }
  } catch { /* ignore */ }
  return { club: '', clubLogo: '' };
}

async function main() {
  console.log('⚽ Building player clubs lookup...');

  const teamsData = await fetchJSON(
    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams?limit=100'
  );

  const teams: any[] = (teamsData.sports?.[0]?.leagues?.[0]?.teams || []).map((t: any) => t.team || t);
  console.log(`📋 Found ${teams.length} WC2026 teams`);

  // Load existing data to avoid re-fetching players we already have club info for
  const outPath = path.resolve(process.cwd(), 'data', 'player-clubs.json');
  let existing: Record<string, any> = {};
  try { existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')); } catch {}

  const playerClubs: Record<string, {
    name: string; club: string; teamName: string; teamAbbr: string;
    position: string; jersey: string; clubLogo?: string;
  }> = { ...existing };

  // Pass 1: collect player metadata from WC rosters
  const needsClub: Array<{ id: string; name: string }> = [];

  for (const team of teams) {
    const teamId = team.id;
    const teamName = team.displayName || team.name || teamId;
    console.log(`🔍 Roster: ${teamName}...`);
    try {
      const rosterData = await fetchJSON(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${teamId}/roster`
      );
      const athletes: any[] = rosterData.roster || rosterData.athletes || rosterData.items || [];
      for (const entry of athletes) {
        const ath = entry.athlete || entry;
        const id = String(ath.id || '');
        if (!id) continue;
        const name = ath.displayName || ath.fullName || '';
        const position = ath.position?.abbreviation || ath.position?.displayName || entry.position?.abbreviation || '';
        const jersey = String(ath.jersey || entry.jersey || '');
        if (!playerClubs[id]) {
          playerClubs[id] = { name, club: '', teamName: team.displayName || '', teamAbbr: team.abbreviation || '', position, jersey };
        }
        if (!playerClubs[id].club) needsClub.push({ id, name });
      }
    } catch (err: any) {
      console.warn(`  ⚠️ ${err.message}`);
    }
    await sleep(300);
  }

  // Pass 2: look up club via TheSportsDB (reliable club data, not affected by WC context)
  console.log(`\n🔄 Looking up ${needsClub.length} players via TheSportsDB...`);
  let filled = 0;
  for (const { id, name } of needsClub) {
    const { club, clubLogo } = await lookupClubViaSportsDB(name);
    if (club) {
      playerClubs[id].club = club;
      if (clubLogo) playerClubs[id].clubLogo = clubLogo;
      filled++;
      if (filled % 50 === 0) console.log(`  ${filled}/${needsClub.length} filled...`);
    }
    await sleep(200); // TheSportsDB free tier: be polite
  }

  const total = Object.keys(playerClubs).length;
  const withClub = Object.values(playerClubs).filter(v => v.club).length;
  console.log(`\n📊 ${total} players, ${withClub} with club (${Math.round(withClub / total * 100)}%)`);

  fs.writeFileSync(outPath, JSON.stringify(playerClubs, null, 2), 'utf-8');
  console.log(`🎉 Written to ${outPath}`);
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
