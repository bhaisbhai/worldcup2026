module.exports = async function handler(req, res) {
  const url   = process.env.KV_REST_API_URL   || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const result = {};

  try {
    // Test write using JSON body format (avoids URL-encoding issues)
    const setRes = await fetch(`${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(['SET', 'push:test_key', 'test_value', 'EX', '60']),
    });
    result.set_status = setRes.status;
    result.set_body   = await setRes.json();

    // Read it back
    const getRes = await fetch(`${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(['GET', 'push:test_key']),
    });
    result.get_status = getRes.status;
    result.get_body   = await getRes.json();

    // Clean up
    await fetch(`${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(['DEL', 'push:test_key']),
    });
  } catch (e) {
    result.error = e.message;
  }

  res.status(200).json(result);
};
