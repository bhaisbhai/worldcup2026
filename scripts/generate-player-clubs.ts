import * as fs from 'fs';
import * as path from 'path';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJSON(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'WC2026-GameBuddy/1.0 (wikidata-club-lookup)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
}

// Batch query Wikidata SPARQL for current clubs, filtering out national teams
async function queryWikidataClubs(names: string[]): Promise<Map<string, string>> {
  const valuesClause = names
    .map(n => `"${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`)
    .join('\n    ');

  const sparql = `
SELECT DISTINCT ?searchName ?clubLabel WHERE {
  VALUES ?searchName { ${valuesClause} }
  ?player rdfs:label ?playerLabel .
  FILTER(LCASE(STR(?playerLabel)) = LCASE(STR(?searchName)) && LANG(?playerLabel) = "en")
  ?player wdt:P106 wd:Q937857 .
  ?player p:P54 ?stmt .
  ?stmt ps:P54 ?club .
  FILTER NOT EXISTS { ?stmt pq:P582 [] }
  FILTER NOT EXISTS { ?club wdt:P31 wd:Q17156793 }
  ?club rdfs:label ?clubLabel FILTER(LANG(?clubLabel) = "en")
}
LIMIT 1000`;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  const data = await fetchJSON(url);

  const result = new Map<string, string>();
  for (const row of data.results?.bindings || []) {
    const searchName = row.searchName?.value;
    const clubLabel = row.clubLabel?.value;
    if (searchName && clubLabel && !result.has(searchName)) {
      result.set(searchName, clubLabel);
    }
  }
  return result;
}

// Fallback: search Wikidata by name for a single player
async function lookupClubViaWikidataSearch(name: string): Promise<string> {
  try {
    const searchData = await fetchJSON(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&format=json&limit=5`
    );

    for (const result of searchData.search || []) {
      const desc = (result.description || '').toLowerCase();
      if (!desc.includes('football') && !desc.includes('soccer')) continue;

      const qid = result.id;
      const entityData = await fetchJSON(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`
      );
      const entity = entityData.entities?.[qid];
      if (!entity?.claims) continue;

      const occupations: any[] = entity.claims.P106 || [];
      const isFootballer = occupations.some(c => c.mainsnak?.datavalue?.value?.id === 'Q937857');
      if (!isFootballer) continue;

      // Current club: P54 claims without end-time qualifier (P582)
      const teamClaims: any[] = entity.claims.P54 || [];
      const currentQids = teamClaims
        .filter(c => !c.qualifiers?.P582)
        .map(c => c.mainsnak?.datavalue?.value?.id)
        .filter(Boolean);

      if (!currentQids.length) continue;

      // Batch fetch team entities
      const teamData = await fetchJSON(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${currentQids.slice(0,10).join('|')}&props=claims|labels&languages=en&format=json`
      );

      for (const teamQid of currentQids) {
        const te = teamData.entities?.[teamQid];
        if (!te) continue;
        const types: any[] = te.claims?.P31 || [];
        const isNational = types.some(c => c.mainsnak?.datavalue?.value?.id === 'Q17156793');
        if (isNational) continue;
        const club = te.labels?.en?.value || '';
        if (club) return club;
      }
    }
  } catch { /* ignore */ }
  return '';
}

async function main() {
  console.log('⚽ Building player clubs lookup via Wikidata...');

  const teamsData = await fetchJSON(
    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams?limit=100'
  );

  const teams: any[] = (teamsData.sports?.[0]?.leagues?.[0]?.teams || []).map((t: any) => t.team || t);
  console.log(`📋 Found ${teams.length} WC2026 teams`);

  const outPath = path.resolve(process.cwd(), 'data', 'player-clubs.json');
  let playerClubs: Record<string, any> = {};
  try { playerClubs = JSON.parse(fs.readFileSync(outPath, 'utf-8')); } catch {}

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

  console.log(`\n🔄 Looking up ${needsClub.length} players via Wikidata SPARQL (batches of 80)...`);

  // Pass 2: batch SPARQL queries
  const BATCH = 80;
  let filled = 0;
  const fallbackQueue: Array<{ id: string; name: string }> = [];

  for (let i = 0; i < needsClub.length; i += BATCH) {
    const batch = needsClub.slice(i, i + BATCH);
    const batchNames = batch.map(p => p.name);
    console.log(`  Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(needsClub.length/BATCH)}: ${batchNames[0]} ... ${batchNames[batchNames.length-1]}`);

    try {
      const clubMap = await queryWikidataClubs(batchNames);
      for (const { id, name } of batch) {
        const club = clubMap.get(name) || '';
        if (club) {
          playerClubs[id].club = club;
          filled++;
        } else {
          fallbackQueue.push({ id, name });
        }
      }
      console.log(`    → ${clubMap.size} found`);
    } catch (err: any) {
      console.warn(`    ⚠️ SPARQL batch failed: ${err.message}`);
      fallbackQueue.push(...batch);
    }

    await sleep(1500); // Wikidata asks for 1s+ between SPARQL requests
  }

  // Pass 3: fallback individual search for players SPARQL missed
  console.log(`\n🔄 Fallback search for ${fallbackQueue.length} unmatched players...`);
  let fallbackFilled = 0;
  for (let i = 0; i < fallbackQueue.length; i++) {
    const { id, name } = fallbackQueue[i];
    const club = await lookupClubViaWikidataSearch(name);
    if (club) {
      playerClubs[id].club = club;
      filled++;
      fallbackFilled++;
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i+1}/${fallbackQueue.length} fallback done, ${fallbackFilled} found`);
    await sleep(300);
  }

  const total = Object.keys(playerClubs).length;
  const withClub = Object.values(playerClubs).filter((v: any) => v.club).length;
  console.log(`\n📊 ${total} players, ${withClub} with club (${Math.round(withClub / total * 100)}%)`);

  fs.writeFileSync(outPath, JSON.stringify(playerClubs, null, 2), 'utf-8');
  console.log(`🎉 Written to ${outPath}`);
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
