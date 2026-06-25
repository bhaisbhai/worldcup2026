import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = process.env.KV_REST_API_URL || '(not set)';
  const token = process.env.KV_REST_API_TOKEN || '(not set)';

  const result = {
    url_set: url !== '(not set)',
    url_prefix: url.slice(0, 30),
    token_set: token !== '(not set)',
    token_prefix: token.slice(0, 10),
  };

  try {
    const redis = new Redis({ url, token });
    await redis.ping();
    result.redis_ping = 'OK';
    const keys = await redis.keys('push:*');
    result.subscriber_count = keys.length;
  } catch (e) {
    result.redis_error = e.message;
  }

  res.status(200).json(result);
}
