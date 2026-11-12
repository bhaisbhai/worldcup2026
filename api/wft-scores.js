// Global leaderboards for Wheelie Fun Turbo (a game-buddy-pl project), reusing the same
// Upstash Redis instance already configured here for Keepy Uppy's leaderboard (game-scores.js).
// Two boards, each a Redis sorted set:
//   - laptime: one set per track (wft_lap_<trackId>), member = player name, score = best lap
//     time in ms. ZADD ... LT only overwrites a member's score if the new one is lower, so each
//     player keeps exactly one entry: their personal best for that track.
//   - cup: one set (wft_cup_total), member = player name, score = career total cup points.
//     ZINCRBY so every completed cup adds to the player's running total.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(command, ...args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

const TRACK_RE = /^[a-zA-Z0-9_-]{1,40}$/;

function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, 16);
  return trimmed.length ? trimmed : null;
}

function pairsToScores(raw, valueKey) {
  const scores = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) {
      scores.push({ rank: scores.length + 1, name: raw[i], [valueKey]: parseInt(raw[i + 1], 10) });
    }
  }
  return scores;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'Leaderboard not configured' });
  }

  const board = (req.query.board || '').toString();

  try {
    if (req.method === 'GET') {
      if (board === 'laptime') {
        const track = (req.query.track || '').toString();
        if (!TRACK_RE.test(track)) return res.status(400).json({ error: 'Invalid track' });
        const raw = await redis('ZRANGE', `wft_lap_${track}`, 0, 49, 'WITHSCORES');
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ scores: pairsToScores(raw, 'timeMs') });
      }
      if (board === 'cup') {
        const raw = await redis('ZREVRANGE', 'wft_cup_total', 0, 49, 'WITHSCORES');
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ scores: pairsToScores(raw, 'points') });
      }
      return res.status(400).json({ error: 'Unknown board' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const name = sanitizeName(body && body.name);
      if (!name) return res.status(400).json({ error: 'Invalid name' });

      if (board === 'laptime') {
        const track = (body.track || '').toString();
        const timeMs = Number(body.timeMs);
        if (!TRACK_RE.test(track)) return res.status(400).json({ error: 'Invalid track' });
        if (!Number.isFinite(timeMs) || timeMs < 1000 || timeMs > 900000) {
          return res.status(400).json({ error: 'Invalid time' });
        }
        await redis('ZADD', `wft_lap_${track}`, 'LT', timeMs, name);
        return res.json({ ok: true });
      }
      if (board === 'cup') {
        const points = Number(body.points);
        if (!Number.isFinite(points) || points < 0 || points > 200) {
          return res.status(400).json({ error: 'Invalid points' });
        }
        await redis('ZINCRBY', 'wft_cup_total', points, name);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown board' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('wft-scores error:', err);
    // Temporary: surface the real failure (plus Node's underlying cause, e.g. a
    // DNS/TLS/connection-refused code) in the response body, since this sandbox
    // has no way to read Vercel's own function logs.
    let redisHost = null;
    try { redisHost = new URL(REDIS_URL).hostname; } catch (e) {}
    return res.status(500).json({
      error: 'Server error',
      detail: err && err.message,
      cause: err && err.cause && (err.cause.code || err.cause.message || String(err.cause)),
      redisHost,
      hasToken: !!REDIS_TOKEN,
    });
  }
};
