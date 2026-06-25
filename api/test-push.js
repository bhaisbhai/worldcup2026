module.exports = async function handler(req, res) {
  const url   = process.env.KV_REST_API_URL   || '';
  const token = process.env.KV_REST_API_TOKEN || '';

  const result = {
    url_prefix:   url.slice(0, 35),
    token_prefix: token.slice(0, 10),
  };

  try {
    const ping = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    result.ping_status = ping.status;
    result.ping_body   = await ping.json();

    const keys = await fetch(`${url}/keys/push%3A*`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    result.keys_status = keys.status;
    result.keys_body   = await keys.json();
  } catch (e) {
    result.error = e.message;
  }

  res.status(200).json(result);
};
