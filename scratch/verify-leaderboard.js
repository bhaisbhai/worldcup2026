import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'kuking_leaderboard';

if (!url || !token) {
  console.error('Missing credentials');
  process.exit(1);
}

async function run() {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['ZREVRANGE', KEY, 0, -1, 'WITHSCORES']),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch: ${await res.text()}`);
    }

    const raw = (await res.json()).result;
    const scores = [];

    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i += 2) {
        const memberStr = raw[i];
        const score = parseInt(raw[i + 1], 10);
        try {
          const entry = JSON.parse(memberStr);
          scores.push({
            rank: scores.length + 1,
            score,
            ...entry,
            rawString: memberStr
          });
        } catch (_) {
          scores.push({
            rank: scores.length + 1,
            score,
            name: memberStr,
            error: 'Not valid JSON'
          });
        }
      }
    }

    console.log('Leaderboard Content:');
    console.table(scores.map(s => ({
      Rank: s.rank,
      Name: s.name,
      Score: s.score,
      Combo: s.combo,
      Perfects: s.perfects,
      Date: s.date
    })));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
