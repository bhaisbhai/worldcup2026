'use strict';
const YT_PLAYLIST = 'https://www.googleapis.com/youtube/v3/playlistItems';
const YT_SEARCH   = 'https://www.googleapis.com/youtube/v3/search';
const BBC_UPLOADS = 'UUli0KmmXMDjcgqvsheHfv-Q';

module.exports = async function handler(req, res) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });

  const { mode, q, pageToken } = req.query;
  let url;
  if (mode === 'catalog') {
    url = `${YT_PLAYLIST}?part=snippet&playlistId=${BBC_UPLOADS}&maxResults=50${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}&key=${key}`;
  } else if (q) {
    url = `${YT_SEARCH}?part=snippet&q=${encodeURIComponent(q)}&type=video&order=relevance&maxResults=10&key=${key}`;
  } else {
    return res.status(400).json({ error: 'Missing parameters: provide mode=catalog or q=<query>' });
  }

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t.slice(0, 300) });
    }
    const data = await r.json();
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=300');
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
