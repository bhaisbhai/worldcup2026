import * as fs from 'fs';
import * as path from 'path';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

interface PlayerStats {
  name: string;
  teamName: string;
  teamAbbr: string;
  appearances: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  minutesPlayed: number;
  headshot?: string;
}

function dateRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startIso + 'T12:00:00Z');
  const end = new Date(endIso + 'T12:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0,10).replace(/-/g,''));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function main() {
  console.log('⚽ Aggregating player tournament stats from match summaries...');

  // Collect all events across the WC 2026 window (group stage + knockouts June 11 – July 19)
  const today = new Date().toISOString().slice(0,10);
  const days = dateRange('2026-06-11', today);
  const seenIds = new Set<string>();
  const allCompleted: any[] = [];

  for (const d of days) {
    try {
      const scoreData = await fetchJSON(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${d}`
      );
      for (const ev of scoreData.events || []) {
        if (!seenIds.has(ev.id) && ev.status?.type?.completed === true) {
          seenIds.add(ev.id);
          allCompleted.push(ev);
        }
      }
    } catch { /* skip day */ }
    await sleep(100);
  }

  const completed = allCompleted;
  console.log(`📋 ${completed.length} completed matches across WC 2026 so far`);

  const playerStats: Record<string, PlayerStats> = {};

  for (const event of completed) {
    const eventId = event.id;
    const label = event.shortName || event.name || eventId;
    console.log(`🔍 ${label} (id=${eventId})...`);

    try {
      const summary = await fetchJSON(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`
      );
      for (const team of summary.rosters || []) {
        for (const entry of team.roster || []) {
          const ath = entry.athlete || {};
          const id = String(ath.id || '');
          if (!id) continue;

          const stats: any[] = entry.stats || [];
          const sv = (name: string) => {
            const s = stats.find((x: any) => x.name === name);
            return s ? (parseFloat(String(s.value)) || 0) : 0;
          };

          const mins = sv('minutesPlayed');
          if (entry.starter === true || mins > 0) {
            if (!playerStats[id]) {
              playerStats[id] = {
                name: ath.displayName || ath.fullName || '',
                teamName: team.team?.displayName || '',
                teamAbbr: team.team?.abbreviation || '',
                appearances: 0,
                goals: 0,
                assists: 0,
                shots: 0,
                shotsOnTarget: 0,
                saves: 0,
                yellowCards: 0,
                redCards: 0,
                minutesPlayed: 0,
              };
              const hs = ath.headshot?.href || ath.headshot;
              if (hs) playerStats[id].headshot = hs;
            }

            playerStats[id].appearances++;
            playerStats[id].goals        += sv('totalGoals');
            playerStats[id].assists      += sv('goalAssists');
            playerStats[id].shots        += sv('totalShots');
            playerStats[id].shotsOnTarget+= sv('shotsOnTarget');
            playerStats[id].saves        += sv('saves');
            playerStats[id].yellowCards  += sv('yellowCards');
            playerStats[id].redCards     += sv('redCards');
            playerStats[id].minutesPlayed+= mins;
          }
        }
      }

      console.log(`  ✅ done`);
    } catch (err: any) {
      console.warn(`  ⚠️ ${err.message}`);
    }

    await sleep(300);
  }

  const total = Object.keys(playerStats).length;
  const scorers = Object.values(playerStats).filter(p => p.goals > 0).length;
  console.log(`\n📊 ${total} players across ${completed.length} matches, ${scorers} with goals`);

  const outPath = path.resolve(process.cwd(), 'data', 'player-stats.json');
  fs.writeFileSync(outPath, JSON.stringify(playerStats, null, 2), 'utf-8');
  console.log(`🎉 Written to ${outPath}`);
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
