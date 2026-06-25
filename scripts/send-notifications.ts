import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ONESIGNAL_APP_ID     = process.env.ONESIGNAL_APP_ID || '';
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';
const APP_URL = process.env.APP_URL || 'https://game-buddy.co.uk';

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function ptDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

async function send(title: string, body: string): Promise<void> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    throw new Error('Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY');
  }
  const res = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      included_segments: ['All'],
      headings: { en: title },
      contents: { en: body },
      url: APP_URL,
    }),
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(`OneSignal error: ${JSON.stringify(data)}`);
  console.log(`✅  Sent "${title}" — id: ${data.id}`);
}

async function sendMorningDigest(): Promise<void> {
  const today = ptDate();
  const ds    = today.replace(/-/g, '');

  console.log(`📅  Fetching fixtures for ${today}…`);
  const sb = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ds}`
  );

  const events: any[] = sb.events || [];
  if (events.length === 0) {
    console.log('ℹ️  No games today — skipping notification.');
    return;
  }

  const lines = events.map(ev => {
    const comp = ev.competitions?.[0] || {};
    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
    if (!home || !away) return null;

    const homeAbbr = home.team?.abbreviation || home.team?.displayName || '?';
    const awayAbbr = away.team?.abbreviation || away.team?.displayName || '?';
    const kickoff  = new Date(ev.date);
    const timeStr  = kickoff.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    return `${homeAbbr} vs ${awayAbbr} ${timeStr}`;
  }).filter(Boolean) as string[];

  const count = lines.length;
  const title = `⚽ ${count} game${count !== 1 ? 's' : ''} today`;
  const body  = lines.join(' · ');

  await send(title, body);
}

async function sendRecapReady(): Promise<void> {
  // Only send if yesterday's recap actually exists
  const recapsPath = path.resolve(__dirname, '..', 'data', 'recaps.json');
  const yesterday  = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ptDate(d); })();

  if (fs.existsSync(recapsPath)) {
    const recaps: any[] = JSON.parse(fs.readFileSync(recapsPath, 'utf-8'));
    const exists = recaps.some(r => r.date === yesterday && (r.summary || r.headline));
    if (!exists) {
      console.log(`ℹ️  No recap for ${yesterday} — skipping notification.`);
      return;
    }
  }

  await send("📋 Yesterday's recap is ready", "Check the latest World Cup results and match summary.");
}

async function main(): Promise<void> {
  const type = process.argv.slice(2).find(a => a.startsWith('--type='))?.split('=')[1];

  if (type === 'digest') {
    await sendMorningDigest();
  } else if (type === 'recap') {
    await sendRecapReady();
  } else {
    console.error('Usage: tsx scripts/send-notifications.ts --type=digest | --type=recap');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌  Crashed:', err);
  process.exit(1);
});
