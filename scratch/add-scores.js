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

const friends = [
  { name: 'KIRSTY', score: 6 },
  { name: 'GAGAN', score: 18 },
  { name: 'SAM', score: 296 },
  { name: 'LISA', score: 66 }
];

async function addScore(friend) {
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  const member = JSON.stringify({
    name: friend.name,
    combo: 0,
    perfects: 0,
    date: date
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['ZADD', KEY, 'GT', friend.score, member]),
  });

  if (!res.ok) {
    throw new Error(`Failed to add ${friend.name}: ${await res.text()}`);
  }
  const body = await res.json();
  console.log(`Added ${friend.name} (Score: ${friend.score}):`, body);
}

async function run() {
  try {
    for (const friend of friends) {
      await addScore(friend);
    }
    console.log('All scores added successfully!');
  } catch (err) {
    console.error('Error adding scores:', err);
  }
}

run();
