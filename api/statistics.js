module.exports = async function(req, res) {
  const urls = [
    'https://site.api.espn.com/apis/v4/sports/soccer/fifa.world/statistics?season=2026',
    'https://site.api.espn.com/apis/v4/sports/soccer/fifa.world/statistics',
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      // Return if there's actual category/leader data
      const cats = data.categories || data.leaders || data.results?.categories || [];
      if (cats.length) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        return res.json(data);
      }
    } catch(e) { continue; }
  }

  // Nothing found — return empty
  res.json({ categories: [] });
};
