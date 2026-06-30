const fs = require('fs');
const path = require('path');

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
if (!fs.existsSync(masterPath)) {
  console.error("❌ master JSON does not exist!");
  process.exit(1);
}

const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
const espnStandings = masterDB.espnStandings || [];
const espnMatches = masterDB.espnMatches || {};

function getGroupName(index) {
  const groups = ['Group A', 'Group B', 'Group C', 'Group D', 'Group E', 'Group F', 'Group G', 'Group H', 'Group I', 'Group J', 'Group K', 'Group L'];
  return groups[index] || `Group ${index + 1}`;
}

function computeStandingsAndStatus(masterDB, targetDate) {
  const teamStandingsMap = new Map();
  const groupTeamsMap = new Map();
  const completedMatches = [];

  // Initialize group and team mappings
  espnStandings.forEach((g, gIdx) => {
    const gName = g.group || getGroupName(gIdx);
    const codes = [];
    for (const t of g.teams || []) {
      const code = t.code;
      if (!code) continue;
      teamStandingsMap.set(code, {
        code,
        name: t.name,
        group: gName,
        mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, gd: 0
      });
      codes.push(code);
    }
    groupTeamsMap.set(gName, codes);
  });

  // Collect all completed matches up to targetDate
  for (const date of Object.keys(espnMatches)) {
    if (date > targetDate) continue;
    for (const m of espnMatches[date] || []) {
      const isCompleted = m.status === 'STATUS_FINAL' || m.status === 'STATUS_FULL_TIME';
      if (!isCompleted) continue;

      const h = teamStandingsMap.get(m.homeTeam);
      const a = teamStandingsMap.get(m.awayTeam);
      if (h && a && h.group === a.group) {
        completedMatches.push({
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore
        });
      }
    }
  }

  // Update standings using completed matches
  for (const match of completedMatches) {
    const home = teamStandingsMap.get(match.homeTeam);
    const away = teamStandingsMap.get(match.awayTeam);
    if (home) {
      home.mp += 1;
      home.gf += match.homeScore;
      home.ga += match.awayScore;
      home.gd = home.gf - home.ga;
      if (match.homeScore > match.awayScore) { home.w += 1; home.pts += 3; }
      else if (match.homeScore === match.awayScore) { home.d += 1; home.pts += 1; }
      else { home.l += 1; }
    }
    if (away) {
      away.mp += 1;
      away.gf += match.awayScore;
      away.ga += match.homeScore;
      away.gd = away.gf - away.ga;
      if (match.awayScore > match.homeScore) { away.w += 1; away.pts += 3; }
      else if (match.awayScore === match.homeScore) { away.d += 1; away.pts += 1; }
      else { away.l += 1; }
    }
  }

  const statusLines = [];
  for (const [gName, codes] of groupTeamsMap) {
    const entries = codes
      .map(code => teamStandingsMap.get(code))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    entries.forEach(t => {
      // Simple status calculation for debugging
      let status = 'UNKNOWN';
      if (t.mp === 3) {
        const pos = entries.findIndex(x => x.code === t.code) + 1;
        if (pos <= 2) status = 'QUALIFIED';
        else if (pos === 3) status = t.pts >= 4 ? 'POSSIBLE BEST-3RD' : 'ELIMINATED';
        else status = 'ELIMINATED';
      } else {
        status = 'IN CONTENTION';
      }
      statusLines.push(`  ${t.code} (${t.name}): ${status} (P${t.mp} Pts${t.pts})`);
    });
  }
  return statusLines.join('\n');
}

for (const date of Object.keys(espnMatches).sort()) {
  console.log(`\n--- Date: ${date} ---`);
  console.log(computeStandingsAndStatus(masterDB, date));
}
