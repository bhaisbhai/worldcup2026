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

const namesToRemove = ['BOB', 'TOM', 'BIGMEEKS'];

async function run() {
  try {
    // 1. Fetch all members from the sorted set
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
    const toRemove = [];

    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i += 2) {
        const memberStr = raw[i];
        try {
          const entry = JSON.parse(memberStr);
          if (entry && entry.name && namesToRemove.includes(entry.name.toUpperCase())) {
            toRemove.push(memberStr);
          }
        } catch (_) {
          // If it's not JSON, skip or check if it matches the name directly
        }
      }
    }

    if (toRemove.length === 0) {
      console.log('No matching members found to remove.');
      return;
    }

    console.log('Members to remove:', toRemove);

    // 2. Call ZREM for each matched member string
    const deleteRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['ZREM', KEY, ...toRemove]),
    });

    if (!deleteRes.ok) {
      throw new Error(`Failed to delete: ${await deleteRes.text()}`);
    }

    const deleteResult = await deleteRes.json();
    console.log('Delete result:', deleteResult);
    console.log('Successfully removed members!');
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
