import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

webpush.setVapidDetails(
  'mailto:raj.arjan@gmail.com',
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || '',
);

const redis = new Redis({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
});

const APP_URL = process.env.APP_URL || 'https://game-buddy.co.uk';

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function ptDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

async function getAllSubscriptions(): Promise<any[]> {
  const keys = await redis.keys('push:*');
  if (!keys.length) return [];
  const values = await Promise.all(keys.map(k => redis.get(k)));
  return values.filter(Boolean).map(v => (typeof v === 'string' ? JSON.parse(v) : v));
}

async function broadcast(title: string, body: string): Promise<void> {
  const subs = await getAllSubscriptions();
  if (!subs.length) { console.log('ℹ️  No subscribers.'); return; }

  console.log(`📤  Sending to ${subs.length} subscriber(s)…`);
  const payload = JSON.stringify({ title, body, url: APP_URL });

  const results = await Promise.allSettled(
    subs.map(sub => webpush.sendNotification(sub, payload))
  );

  let sent = 0, failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') { sent++; }
    else {
      failed++;
      const err = r.reason as any;
      // 404/410 means subscription is expired — remove it
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        const sub = subs[results.indexOf(r)];
        if (sub?.endpoint) {
          const key = 'push:' + Buffer.from(sub.endpoint).toString('base64').slice(-40).replace(/[^a-zA-Z0-9]/g, '_');
          await redis.del(key);
        }
      }
    }
  }
  console.log(`✅  Sent: ${sent}  Failed/removed: ${failed}`);
}

async function sendMorningDigest(): Promise<void> {
  const today = ptDate();
  const ds    = today.replace(/-/g, '');

  console.log(`📅  Fetching fixtures for ${today}…`);
  const sb = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ds}`
  );

  const events: any[] = sb.events || [];
  if (!events.length) { console.log('ℹ️  No games today.'); return; }

  const lines = events.map((ev: any) => {
    const comp = ev.competitions?.[0] || {};
    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
    if (!home || !away) return null;
    const kickoff = new Date(ev.date);
    const t = kickoff.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return `${home.team?.abbreviation || '?'} vs ${away.team?.abbreviation || '?'} ${t}`;
  }).filter(Boolean) as string[];

  const n = lines.length;
  await broadcast(`⚽ ${n} game${n !== 1 ? 's' : ''} today`, lines.join(' · '));
}

async function sendRecapReady(): Promise<void> {
  const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
  const yesterday  = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ptDate(d); })();

  if (fs.existsSync(recapsPath)) {
    const recaps: any[] = JSON.parse(fs.readFileSync(recapsPath, 'utf-8'));
    if (!recaps.some(r => r.date === yesterday && (r.summary || r.headline))) {
      console.log(`ℹ️  No recap for ${yesterday} — skipping.`); return;
    }
  }

  await broadcast("📋 Yesterday's recap is ready", "Tap to see the match summary and results.");
}

async function main(): Promise<void> {
  const type = process.argv.slice(2).find(a => a.startsWith('--type='))?.split('=')[1];
  if (type === 'digest') await sendMorningDigest();
  else if (type === 'recap') await sendRecapReady();
  else { console.error('Usage: --type=digest | --type=recap'); process.exit(1); }
}

main().catch(err => { console.error('❌', err); process.exit(1); });
