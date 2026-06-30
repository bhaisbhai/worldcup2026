import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));

// Helper to assign group names if they are empty
function getGroupName(index) {
  const groups = ['Group A', 'Group B', 'Group C', 'Group D', 'Group E', 'Group F', 'Group G', 'Group H', 'Group I', 'Group J', 'Group K', 'Group L'];
  return groups[index] || `Group ${index + 1}`;
}

function computeStandingsAndStatus(masterDB, targetDate) {
  const espnStandings = masterDB.espnStandings || [];
  const espnMatches = masterDB.espnMatches || {};

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
  const groupStandings = [];

  for (const [gName, codes] of groupTeamsMap) {
    // Deduce remaining matches for this group
    const remainingMatches = [];
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const team1 = codes[i];
        const team2 = codes[j];

        // Check if already played
        const played = completedMatches.some(m =>
          (m.homeTeam === team1 && m.awayTeam === team2) ||
          (m.homeTeam === team2 && m.awayTeam === team1)
        );

        if (!played) {
          remainingMatches.push({ homeTeam: team1, awayTeam: team2 });
        }
      }
    }

    // Generate scenarios recursively
    const scenarios = [];
    function genScenarios(index, currentScenario) {
      if (index === remainingMatches.length) {
        scenarios.push([...currentScenario]);
        return;
      }
      // Outcome 1: Home Win (1-0)
      currentScenario.push({ match: remainingMatches[index], outcome: 'H' });
      genScenarios(index + 1, currentScenario);
      currentScenario.pop();

      // Outcome 2: Draw (0-0)
      currentScenario.push({ match: remainingMatches[index], outcome: 'D' });
      genScenarios(index + 1, currentScenario);
      currentScenario.pop();

      // Outcome 3: Away Win (0-1)
      currentScenario.push({ match: remainingMatches[index], outcome: 'A' });
      genScenarios(index + 1, currentScenario);
      currentScenario.pop();
    }
    genScenarios(0, []);

    // Track simulated ranks and points for each team
    const teamStats = {};
    codes.forEach(code => {
      teamStats[code] = {
        ranks: [],
        ptsList: []
      };
    });

    // Evaluate all scenarios
    scenarios.forEach(scen => {
      // Clone current standings
      const clone = {};
      codes.forEach(code => {
        const t = teamStandingsMap.get(code);
        clone[code] = { ...t };
      });

      // Apply scenario outcomes
      scen.forEach(({ match, outcome }) => {
        const home = clone[match.homeTeam];
        const away = clone[match.awayTeam];
        if (outcome === 'H') {
          home.pts += 3; home.gf += 1; home.gd += 1;
          away.ga += 1; away.gd -= 1;
        } else if (outcome === 'D') {
          home.pts += 1;
          away.pts += 1;
        } else {
          away.pts += 3; away.gf += 1; away.gd += 1;
          home.ga += 1; home.gd -= 1;
        }
      });

      // Sort clone
      const sorted = Object.values(clone).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      sorted.forEach((team, idx) => {
        teamStats[team.code].ranks.push(idx + 1);
        teamStats[team.code].ptsList.push(team.pts);
      });
    });

    // Determine final status for each team based on simulated outcomes
    const entries = codes
      .map(code => teamStandingsMap.get(code))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    const rows = entries.map(t =>
      `  ${t.code.padEnd(4)} P${t.mp} W${t.w} D${t.d} L${t.l} GF${t.gf} GA${t.ga} Pts${t.pts}`
    );
    groupStandings.push(`${gName}:\n${rows.join('\n')}`);

    statusLines.push(`${gName}:`);
    entries.forEach(t => {
      const stats = teamStats[t.code];
      const minRank = Math.min(...stats.ranks); // e.g. 1
      const maxRank = Math.max(...stats.ranks); // e.g. 4
      const minPts = Math.min(...stats.ptsList);
      const maxPts = Math.max(...stats.ptsList);

      let status = '';
      if (maxRank <= 2) {
        status = 'QUALIFIED (top 2 confirmed)';
      } else if (minRank === 4 && maxRank === 4) {
        status = 'ELIMINATED (finished bottom)';
      } else if (t.mp === 3) {
        const pos = entries.findIndex(x => x.code === t.code) + 1;
        if (pos <= 2) {
          status = 'QUALIFIED (top 2 confirmed)';
        } else if (pos === 3) {
          if (t.pts >= 4) {
            status = `POSSIBLE BEST-3RD (${t.pts} pts – awaiting other groups)`;
          } else {
            status = `ELIMINATED (${t.pts} pts after all 3 games – cannot reach best-3rd)`;
          }
        } else {
          status = `ELIMINATED (${t.pts} pts after all 3 games – finished bottom)`;
        }
      } else {
        if (maxPts < 4 && minRank >= 3) {
          status = `ELIMINATED (max ${maxPts} pts possible – cannot reach top 2 or best-3rd)`;
        } else if (minRank >= 3) {
          status = `NEEDS POINTS (cannot reach top 2, best-3rd route only – max ${maxPts} pts possible)`;
        } else {
          status = `IN CONTENTION (can still finish top 2 – ${3 - t.mp} game${3 - t.mp !== 1 ? 's' : ''} left)`;
        }
      }
      statusLines.push(`  ${t.code} (${t.name}): ${status}`);
    });
    statusLines.push('');
  }

  return {
    standingsContext: groupStandings.join('\n\n'),
    advancementStatus: statusLines.join('\n')
  };
}

const res = computeStandingsAndStatus(master, '2026-06-22');
console.log(res.advancementStatus);
