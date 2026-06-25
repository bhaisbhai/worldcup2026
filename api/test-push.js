const KV_URL   = process.env.KV_REST_API_URL   || '(not set)';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '(not set)';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const result = {
    url_set: KV_URL !== '(not set)',
    url_prefix: KV_URL.slice(0, 35),
    token_set: KV_TOKEN !== '(not set)',
    token_prefix: KV_TOKEN.slice(0, 10),
  };

  try {
    const ping = await fetch(`${KV_URL}/ping`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const pingBody = await ping.json();
    result.redis_ping = pingBody.result || pingBody;

    const keys = await fetch(`${KV_URL}/keys/push:*`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const keysBody = await keys.json();
    result.subscriber_count = Array.isArray(keysBody.result) ? keysBody.result.length : keysBody;
  } catch (e) {
    result.redis_error = e.message;
  }

  res.status(200).json(result);
};
