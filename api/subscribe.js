const KV_URL   = process.env.KV_REST_API_URL   || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

function subKey(endpoint) {
  return 'push:' + Buffer.from(endpoint).toString('base64').slice(-40).replace(/[^a-zA-Z0-9]/g, '_');
}

async function redis(cmd) {
  const res = await fetch(`${KV_URL}/${cmd}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const sub = req.body;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    const key = subKey(sub.endpoint);
    const ttl = 60 * 60 * 24 * 400;
    await redis(`set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(sub))}/ex/${ttl}`);
    return res.status(201).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const endpoint = req.body && req.body.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    await redis(`del/${encodeURIComponent(subKey(endpoint))}`);
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
};
