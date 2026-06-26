const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const SUMMARY    = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';

function dateStr(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function get(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

module.exports = async function (req, res) {
  try {
    // ── 1. Collect all completed match IDs from the past 25 days ──
    const now = new Date();
    const dates = Array.from({ length: 25 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      return dateStr(d);
    });

    const seen = new Set();
    const matches = [];

    await Promise.all(dates.map(async date => {
      try {
        const data = await get(`${SCOREBOARD}?dates=${date}&limit=50`);
        for (const ev of data.events || []) {
          const comp = ev.competitions?.[0];
          if (comp?.status?.type?.state === 'post' && !seen.has(ev.id)) {
            seen.add(ev.id);
            matches.push({ id: ev.id, competitors: comp.competitors || [] });
          }
        }
      } catch (e) {}
    }));

    // ── 2. Fetch all summaries in parallel (cap at 50) ──
    const playerMap = {};

    function player(name, teamName, teamAbbr, athleteId = '') {
      const k = `${name}||${teamAbbr}`;
      if (!playerMap[k]) playerMap[k] = { id: athleteId, name, teamName, teamAbbr, goals: 0, assists: 0, yellowCards: 0, redCards: 0, cleanSheets: 0 };
      else if (athleteId && !playerMap[k].id) playerMap[k].id = athleteId;
      return k;
    }

    await Promise.all(matches.slice(0, 120).map(async ({ id, competitors }) => {
      try {
        const data = await get(`${SUMMARY}?event=${id}`);

        // Attempt 1: rosters[].roster[].stats[] — where ESPN soccer actually stores per-player stats
        let gotStats = false;
        for (const teamRoster of data.rosters || []) {
          const tAbbr = teamRoster.team?.abbreviation || '';
          const tName = teamRoster.team?.displayName || '';
          for (const entry of teamRoster.roster || []) {
            const name = entry.athlete?.displayName || '';
            if (!name) continue;
            const athleteId = String(entry.athlete?.id || '');
            const stats = entry.stats || [];
            const getStat = (...names) => {
              for (const n of names) {
                const s = stats.find(x => x.name === n);
                const v = Math.round(parseFloat(s?.value ?? s?.displayValue)) || 0;
                if (v) return v;
              }
              return 0;
            };
            const goals   = getStat('goals', 'totalGoals', 'goalsScored');
            const assists = getStat('goalAssists', 'assists');
            const yellow  = getStat('yellowCards', 'yellow');
            const red     = getStat('redCards', 'red', 'redCard');
            if (goals || assists || yellow || red) {
              const k = player(name, tName, tAbbr, athleteId);
              playerMap[k].goals       += goals;
              playerMap[k].assists     += assists;
              playerMap[k].yellowCards += yellow;
              playerMap[k].redCards    += red;
              gotStats = true;
            } else if (athleteId) {
              // register ID even if no scoring stats yet (may appear in later attempts)
              player(name, tName, tAbbr, athleteId);
            }
          }
        }

        // Attempt 2: boxscore.players fallback
        if (!gotStats) {
          for (const teamSec of data.boxscore?.players || []) {
            const tAbbr = teamSec.team?.abbreviation || '';
            const tName = teamSec.team?.displayName || '';
            for (const cat of teamSec.statistics || []) {
              const keys = (cat.keys || cat.names || []).map(k => k.toLowerCase());
              const idx = {
                goals:   keys.findIndex(k => k === 'goals' || k === 'goal' || k === 'totalgoals'),
                assists: keys.findIndex(k => k === 'assists' || k === 'assist' || k === 'goalassists'),
                yellow:  keys.findIndex(k => k.includes('yellow')),
                red:     keys.findIndex(k => k.includes('redcard') || k === 'red' || k === 'reds'),
              };
              for (const entry of cat.athletes || []) {
                const name = entry.athlete?.displayName || '';
                if (!name) continue;
                const athleteId = String(entry.athlete?.id || '');
                const stats = entry.stats || [];
                const k = player(name, tName, tAbbr, athleteId);
                if (idx.goals   >= 0) { const v = parseInt(stats[idx.goals])   || 0; playerMap[k].goals   += v; if (v) gotStats = true; }
                if (idx.assists >= 0)   playerMap[k].assists     += parseInt(stats[idx.assists]) || 0;
                if (idx.yellow  >= 0)   playerMap[k].yellowCards += parseInt(stats[idx.yellow])  || 0;
                if (idx.red     >= 0)   playerMap[k].redCards    += parseInt(stats[idx.red])     || 0;
              }
            }
          }
        }

        // Attempt 3: keyEvents last resort
        if (!gotStats) {
          for (const ev of data.keyEvents || []) {
            const type = (ev.type?.text || ev.text || '').toLowerCase();
            const isOwnGoal = type.includes('own goal') || type.includes('og');
            const athletes = ev.athletesInvolved || [];
            athletes.forEach((ath, idx) => {
              const name = ath.displayName || '';
              const tAbbr = ath.team?.abbreviation || ev.team?.abbreviation || '';
              const tName = ath.team?.displayName  || ev.team?.displayName  || '';
              const athleteId = String(ath.id || '');
              if (!name) return;
              const k = player(name, tName, tAbbr, athleteId);
              if (type.includes('goal') && !isOwnGoal) {
                if (idx === 0) playerMap[k].goals++;
                if (idx === 1) playerMap[k].assists++;
              } else if (type.includes('yellow') || type === 'caution') {
                playerMap[k].yellowCards++;
              } else if (type.includes('red') || type === 'ejection') {
                playerMap[k].redCards++;
              }
            });
          }
        }

        // Clean sheets: inferred from match scores
        if (competitors.length === 2) {
          const [a, b] = competitors;
          if ((parseInt(b.score) || 0) === 0 && a.team?.abbreviation) {
            const k = player(a.team.displayName, a.team.displayName, a.team.abbreviation);
            playerMap[k].cleanSheets++;
          }
          if ((parseInt(a.score) || 0) === 0 && b.team?.abbreviation) {
            const k = player(b.team.displayName, b.team.displayName, b.team.abbreviation);
            playerMap[k].cleanSheets++;
          }
        }
      } catch (e) {}
    }));

    // ── 3. Build leaderboard tables in ESPN-compatible format ──
    const all = Object.values(playerMap);

    function top(key, n = 10) {
      return all
        .filter(p => p[key] > 0)
        .sort((a, b) => b[key] - a[key])
        .slice(0, n)
        .map(p => ({
          displayValue: String(p[key]),
          value: p[key],
          athlete: {
            id: p.id || '',
            displayName: p.name,
            team: { displayName: p.teamName, abbreviation: p.teamAbbr },
          },
        }));
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({
      categories: [
        { name: 'goals',      displayName: 'Goals',        leaders: top('goals') },
        { name: 'assists',    displayName: 'Assists',       leaders: top('assists') },
        { name: 'yellow',     displayName: 'Yellow Cards',  leaders: top('yellowCards') },
        { name: 'red card',   displayName: 'Red Cards',     leaders: top('redCards') },
        { name: 'clean sheet',displayName: 'Clean Sheets',  leaders: top('cleanSheets') },
      ],
      matchCount: matches.length,
    });
  } catch (e) {
    res.status(500).json({ error: String(e), categories: [] });
  }
};
