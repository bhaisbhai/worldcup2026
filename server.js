const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory cache to avoid hammering ESPN
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

async function espnProxy(espnUrl, req, res) {
  const params = new URLSearchParams(req.query).toString();
  const url = espnUrl + (params ? '?' + params : '');

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'ESPN upstream error', status: upstream.status });
    }
    const data = await upstream.json();
    cache.set(url, { data, ts: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Upstream fetch failed', detail: String(e) });
  }
}

app.get('/api/scoreboard',  (req, res) => espnProxy('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard', req, res));
app.get('/api/standings',   (req, res) => espnProxy('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings', req, res));
app.get('/api/leaders',     (req, res) => espnProxy('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/leaders', req, res));
app.get('/api/summary',     (req, res) => espnProxy('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary', req, res));
app.get('/api/statistics',  (req, res) => espnProxy('https://site.api.espn.com/apis/v4/sports/soccer/fifa.world/statistics', req, res));

app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
