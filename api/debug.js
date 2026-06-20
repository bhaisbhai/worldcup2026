// Returns raw ESPN response shapes so we can verify data structure
module.exports = async function(req, res) {
  const results = {};
  const urls = {
    statistics_season: 'https://site.api.espn.com/apis/v4/sports/soccer/fifa.world/statistics?season=2026',
    statistics_bare:   'https://site.api.espn.com/apis/v4/sports/soccer/fifa.world/statistics',
    leaders_season:    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/leaders?season=2026',
    leaders_bare:      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/leaders',
  };

  await Promise.all(Object.entries(urls).map(async ([key, url]) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      const data = await r.json();
      // Return structure summary + first entry so we know how to parse
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
