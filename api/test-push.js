module.exports = async function handler(req, res) {
  const url   = process.env.KV_REST_API_URL   || '(not set)';
  const token = process.env.KV_REST_API_TOKEN || '(not set)';
  res.status(200).json({
    url_set:      url   !== '(not set)',
    url_prefix:   url.slice(0, 35),
    token_set:    token !== '(not set)',
    token_prefix: token.slice(0, 10),
  });
};
