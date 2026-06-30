import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

console.log('URL:', url);
console.log('Token exists:', !!token);

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
      body: JSON.stringify(['PING']),
    });
    console.log('HTTP Status:', res.status);
    const body = await res.json();
    console.log('Response body:', body);
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

run();
