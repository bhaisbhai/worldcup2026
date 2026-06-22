const KEY = 'kuking_leaderboard';

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

async function redisPipeline(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis pipeline ${res.status}`);
  return await res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'Leaderboard not configured' });
  }

  try {
    if (req.method === 'GET') {
      const raw = await redis('ZREVRANGE', KEY, 0, 9, 'WITHSCORES');
      const scores = [];
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i += 2) {
          try {
            const entry = JSON.parse(raw[i]);
            scores.push({ rank: scores.length + 1, ...entry, score: parseInt(raw[i + 1], 10) });
          } catch (_) {}
        }
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ scores });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { name, score, combo, perfects } = body || {};
      if (typeof name !== 'string' || !name || typeof score !== 'number' || score < 0) {
        return res.status(400).json({ error: 'Invalid data' });
      }
      const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
      const member = JSON.stringify({ name, combo: combo || 0, perfects: perfects || 0, date });
      await redisPipeline([
        ['ZADD', KEY, 'GT', score, member],
        ['ZREMRANGEBYRANK', KEY, 0, -501],
      ]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('game-scores error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
