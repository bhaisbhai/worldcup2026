// Returns raw ESPN response shapes so we can verify data structure
module.exports = async function(req, res) {
  const results = {};

  // Check standings note descriptions to see what ESPN uses for clinched/qualified
  try {
    const r = await fetch('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    const data = await r.json();
    const noteExamples = [];
    (data.children || []).forEach(child => {
      const m = (child.name || '').match(/Group\s+([A-L])/i);
      if (!m) return;
      const gId = m[1].toUpperCase();
      (child.standings?.entries || []).forEach(entry => {
        const note = entry.note?.description || '';
        if (note) {
          noteExamples.push({ group: gId, team: entry.team?.displayName, note });
        }
      });
    });
    results.standings_notes = { status: r.status, count: noteExamples.length, examples: noteExamples };
  } catch(e) {
    results.standings_notes = { error: String(e) };
  }

  // Also check the raw structure of standings entries
  const urls = {
    statistics_season: 'https://site.api.espn.com/apis/v4/sports/soccer/fifa.world/statistics?season=2026',
    leaders_season:    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/leaders?season=2026',
  };

  await Promise.all(Object.entries(urls).map(async ([key, url]) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      const data = await r.json();
      const topKeys = Object.keys(data);
      const firstCat = (data.categories || data.leaders || data.results?.categories || [])[0];
      results[key] = {
        status: r.status,
        topKeys,
        firstCatKeys: firstCat ? Object.keys(firstCat) : [],
        firstCatName: firstCat?.displayName || firstCat?.name || null,
        firstEntryKeys: firstCat ? Object.keys((firstCat.leaders||firstCat.athletes||firstCat.stats||[])[0]||{}) : [],
        catCount: (data.categories || data.leaders || data.results?.categories || []).length,
      };
    } catch(e) {
      results[key] = { error: String(e) };
    }
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.json(results);
};
