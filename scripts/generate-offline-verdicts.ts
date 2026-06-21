import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates = {
  brace: [
    "Absolute liquid football! Bagged a brace and played like he was having a casual kickabout in the park.",
    "A walking cheat code today. Two goals of pure class that left the opposition chasing shadows."
  ],
  goal: [
    "Fancy a goal, do you? A lovely, clinical finish that belonged in the Louvre.",
    "Stepped up when it mattered and took his goal beautifully. Absolute quality."
  ],
  assist: [
    "Served it up on a silver platter with a brilliant pass. Pure vision.",
    "A lovely assist to carve open the defense. Liquid football at its finest."
  ],
  red: [
    "Sent off! Sunday League discipline at its finest. Completely bottled his temper.",
    "An absolute horror show of a challenge to get sent off. Enjoy the early bath."
  ],
  yellow: [
    "Collected a silly booking. Needs to teach his legs to tackle instead of swipe.",
    "Clumsy challenge that rightly earned him a yellow card. Playing with fire."
  ],
  savesHi: [
    "Practically parked a double-decker bus in front of the goal. Made {saves} heroic saves.",
    "Absolute brick wall today! Denied them time and time again with {saves} saves."
  ],
  savesLo: [
    "A solid shift between the sticks, making {saves} saves to keep things tidy.",
    "Did what was asked of him, registering {saves} saves to preserve the scoreline."
  ],
  cardio: [
    "A quiet afternoon. Got some decent cardio in but did absolutely nothing to bother the stat sheet.",
    "Sideways passing that would put a caffeine addict to sleep. Kept it excessively safe.",
    "Ran around a lot, but did about as much useful work as a decorative teapot.",
    "A decent shift, kept it simple, but won't be making the highlights reel anytime soon.",
    "Put in the hard yards defensively but was practically invisible in the final third."
  ],
  subLate: [
    "Subbed on late to run the clock down. Took home a match bonus for breathing the stadium air.",
    "Came on to get some grass on his boots. Barely had time to break a sweat."
  ]
};

function getTemplate(list: string[], seed: string): string {
  const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return list[hash % list.length];
}

async function main() {
  console.log("⚙️ Generating offline pundit verdicts for June 20, 2026...");
  
  const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
  if (!fs.existsSync(masterPath)) {
    console.error("❌ master JSON not found!");
    return;
  }

  const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  const targetDate = '2026-06-20';
  
  // Roster stats are fetched from ESPN match summaries
  // We can fetch the match summaries of June 20 to extract all rosters
  const matches = masterDB.espnMatches[targetDate] || [];
  if (matches.length === 0) {
    console.warn("⚠️ No matches found for June 20 in master JSON.");
    return;
  }

  const verdictsPath = path.resolve(__dirname, '..', 'data', 'player-verdicts.json');
  let verdicts: Record<string, string> = {};
  if (fs.existsSync(verdictsPath)) {
    try {
      verdicts = JSON.parse(fs.readFileSync(verdictsPath, 'utf-8'));
    } catch {}
  }

  let count = 0;
  for (const match of matches) {
    const eventId = match.id;
    console.log(`⚽ Processing match ${match.homeTeam} vs ${match.awayTeam}...`);
    
    try {
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
      const res = await fetch(summaryUrl);
      if (!res.ok) continue;
      const summary = await res.json();
      
      for (const team of summary.rosters || []) {
        for (const entry of team.roster || []) {
          const ath = entry.athlete || {};
          const pid = String(ath.id || '');
          if (!pid) continue;

          const stats = entry.stats || [];
          const getVal = (name: string) => {
            const s = stats.find((x: any) => x.name === name);
            return s ? (parseFloat(String(s.value)) || 0) : 0;
          };

          const mins = getVal('minutesPlayed');
          const starter = entry.starter === true;
          if (starter || mins > 0) {
            const goals = getVal('totalGoals');
            const assists = getVal('goalAssists');
            const yellow = getVal('yellowCards');
            const red = getVal('redCards');
            const saves = getVal('saves');
            
            let verdict = '';
            if (red > 0) {
              verdict = getTemplate(templates.red, pid);
            } else if (goals > 1) {
              verdict = getTemplate(templates.brace, pid);
            } else if (goals === 1) {
              verdict = getTemplate(templates.goal, pid);
            } else if (assists > 0) {
              verdict = getTemplate(templates.assist, pid);
            } else if (saves >= 4) {
              verdict = getTemplate(templates.savesHi, pid).replace('{saves}', String(saves));
            } else if (saves > 0) {
              verdict = getTemplate(templates.savesLo, pid).replace('{saves}', String(saves));
            } else if (yellow > 0) {
              verdict = getTemplate(templates.yellow, pid);
            } else if (mins > 0 && mins < 20) {
              verdict = getTemplate(templates.subLate, pid);
            } else {
              verdict = getTemplate(templates.cardio, pid);
            }

            verdicts[pid] = verdict;
            count++;
          }
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Failed for event ${eventId}: ${err.message}`);
    }
  }

  fs.writeFileSync(verdictsPath, JSON.stringify(verdicts, null, 2), 'utf-8');
  console.log(`🎉 Successfully generated and saved ${count} player verdicts to ${verdictsPath}`);
}

main().catch(err => {
  console.error("❌ Offline generation failed:", err);
});
