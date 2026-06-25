module.exports = function createProxy(espnUrl) {
  return async function(req, res) {
    const params = new URLSearchParams(req.query).toString();
    const url = espnUrl + (params ? '?' + params : '');
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.status(r.status).json({ error: 'ESPN upstream error' });
      const data = await r.json();
      res.setHeader('Cache-Control', 'no-store, s-maxage=10, stale-while-revalidate=10');
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Upstream fetch failed' });
    }
  };
};
