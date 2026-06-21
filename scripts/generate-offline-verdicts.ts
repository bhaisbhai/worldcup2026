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
  
  // Goalkeepers
  gkClean: [
    "Absolute brick wall today! Kept a pristine clean sheet making {saves} saves and marshaled his box with authority.",
    "A goalkeeper's dream. Kept a clean sheet with {saves} saves and never looked like conceding."
  ],
  gkSavesHi: [
    "Practically parked a double-decker bus in front of the goal. Made {saves} heroic saves.",
    "Faced a proper onslaught but stood tall with {saves} saves today."
  ],
  gkConcededHi: [
    "A miserable day between the sticks. Conceded {conceded} goals and looked completely exposed.",
    "Spent more time fishing the ball out of his own net than making saves, conceding {conceded} goals."
  ],
  gkDefault: [
    "Made {saves} saves today but couldn't prevent conceding. A tough afternoon.",
    "Did what he could between the sticks, registering {saves} saves in a busy match."
  ],

  // Defenders (CB, LB, RB, D)
  defClean: [
    "Anchored the backline masterfully today, securing a pristine clean sheet with {clearances} clearances. Absolute defensive rock.",
    "Defended like his life depended on it. Registered {clearances} clearances and secured a crucial clean sheet."
  ],
  defSolid: [
    "Solid defensive performance, holding the backline together with only one minor slip-up.",
    "Anchored the defense effectively, keeping things tight and organized under pressure."
  ],
  defHorror: [
    "Had an absolute horror show at the back as the defense was sliced open like cheap cheese. Sunday League defending.",
    "Completely bottled it defensively today. Caught ball-watching way too many times."
  ],

  // Midfielders (M, CM, DM, AM, LM, RM)
  midPlaymaker: [
    "The puppet master in midfield today. Dictated the tempo and ran the show.",
    "Pulling all the strings in the middle. Kept possession ticking over beautifully."
  ],
  midCardio: [
    "A quiet afternoon. Got some decent cardio in but did absolutely nothing to bother the stat sheet.",
    "Sideways passing that would put a caffeine addict to sleep. Kept it excessively safe."
  ],

  // Forwards (F, ST, CF, LW, RW)
  fwdQuiet: [
    "Isolated and starved of service today. Looked like a lonely figure upfront.",
    "Couldn't find his shooting boots. Kept quiet by the opposition's center-backs."
  ],
  fwdCardio: [
    "Had a quiet afternoon upfront. Got his running in but failed to register a shot on target.",
    "Spent 90 minutes chasing shadows. Needs to get more involved in the build-up play."
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

// Deterministic advanced stats simulator
function derivePlayerAdvancedStats(
  athleteId: string,
  posCode: string,
  mins: number,
  teamAbbr: string,
  matchMeta: any,
  teamStats: any
) {
  const isHome = teamAbbr === matchMeta.homeTeam;
  const oppScore = isHome ? matchMeta.awayScore : matchMeta.homeScore;
  
  // Clean Sheet
  const cleanSheet = oppScore === 0 && mins >= 45;
  
  // Position categorization
  const pos = (posCode || '').toUpperCase();
  const isGK = pos === 'GK' || pos.includes('GOAL');
  const isDEF = pos.includes('D') || pos.includes('B') || pos.includes('BACK');
  const isMID = pos.includes('M') || pos.includes('MID');
  const isFWD = pos.includes('F') || pos.includes('S') || pos.includes('W') || pos.includes('FWD') || pos.includes('STR') || pos.includes('WING');

  // Deterministic seed based on athleteId and matchId
  const matchId = matchMeta.id || '0';
  const seedString = `${athleteId}-${matchId}`;
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = (hash << 5) - hash + seedString.charCodeAt(i);
    hash |= 0;
  }
  const random = () => {
    hash = (hash * 1664525 + 1013904223) | 0;
    return (Math.abs(hash) % 1000) / 1000;
  };

  const teamPasses = isHome ? (teamStats.homePasses || 400) : (teamStats.awayPasses || 400);
  const teamPassPct = isHome ? (teamStats.homePassPct || 80) : (teamStats.awayPassPct || 80);
  const teamClearances = isHome ? (teamStats.homeClearances || 15) : (teamStats.awayClearances || 15);

  let clearances = 0;
  let passesAttempted = 0;
  let passingAccuracy = 0;

  if (mins > 0) {
    if (isGK) {
      clearances = Math.floor(random() * 2);
      passesAttempted = Math.round((teamPasses * 0.05) * (mins / 90) + (random() * 5));
      passingAccuracy = Math.round(teamPassPct - 10 + (random() * 6 - 3));
    } else if (isDEF) {
      clearances = Math.round((teamClearances * (0.2 + random() * 0.15)) * (mins / 90));
      if (clearances < 1 && mins > 45) clearances = Math.round(1 + random() * 3);
      passesAttempted = Math.round((teamPasses * (0.12 + random() * 0.06)) * (mins / 90));
      passingAccuracy = Math.round(teamPassPct + 4 + (random() * 6 - 3));
    } else if (isMID) {
      clearances = Math.round((teamClearances * (0.05 + random() * 0.1)) * (mins / 90));
      passesAttempted = Math.round((teamPasses * (0.16 + random() * 0.08)) * (mins / 90));
      passingAccuracy = Math.round(teamPassPct + 2 + (random() * 6 - 3));
    } else if (isFWD) {
      clearances = Math.floor(random() * 2);
      passesAttempted = Math.round((teamPasses * (0.07 + random() * 0.04)) * (mins / 90));
      passingAccuracy = Math.round(teamPassPct - 6 + (random() * 8 - 4));
    } else {
      clearances = Math.round((teamClearances * 0.1) * (mins / 90));
      passesAttempted = Math.round((teamPasses * 0.1) * (mins / 90));
      passingAccuracy = Math.round(teamPassPct);
    }
  }

  if (passingAccuracy > 99) passingAccuracy = 99;
  if (passingAccuracy < 40) passingAccuracy = 40;
  const passesCompleted = Math.round(passesAttempted * (passingAccuracy / 100));

  return {
    clearances,
    passesCompleted,
    passesAttempted,
    passingAccuracy,
    cleanSheet
  };
}

async function main() {
  console.log("⚙️ Generating position-aware offline pundit verdicts for June 20, 2026...");
  
  const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
  if (!fs.existsSync(masterPath)) {
    console.error("❌ master JSON not found!");
    return;
  }

  const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  const targetDate = '2026-06-20';
  
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
      
      const teamsStats = summary.boxscore?.teams || [];
      const homeCode = match.homeTeam;
      const awayCode = match.awayTeam;
      const homeStatsList = teamsStats.find((t: any) => t.team?.abbreviation === homeCode)?.statistics || [];
      const awayStatsList = teamsStats.find((t: any) => t.team?.abbreviation === awayCode)?.statistics || [];

      const getStatVal = (stats: any[], name: string, fallback: number): number => {
        const st = stats.find((s: any) => s.name === name);
        if (!st) return fallback;
        const cleanVal = String(st.displayValue || st.value || '').replace(/[^0-9]/g, '');
        return cleanVal ? Number(cleanVal) : fallback;
      };

      const teamStats = {
        homePasses: getStatVal(homeStatsList, 'totalPasses', 400),
        awayPasses: getStatVal(awayStatsList, 'totalPasses', 400),
        homePassPct: getStatVal(homeStatsList, 'passPct', 80),
        awayPassPct: getStatVal(awayStatsList, 'passPct', 80),
        homeClearances: getStatVal(homeStatsList, 'totalClearance', getStatVal(homeStatsList, 'effectiveClearance', 15)),
        awayClearances: getStatVal(awayStatsList, 'totalClearance', getStatVal(awayStatsList, 'effectiveClearance', 15))
      };
      
      for (const team of summary.rosters || []) {
        const teamAbbr = team.team?.abbreviation || '';
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
            const goalsConceded = getVal('goalsConceded');
            const posCode = (entry.position?.abbreviation || '').toUpperCase();
            
            const advanced = derivePlayerAdvancedStats(
              pid,
              posCode,
              mins,
              teamAbbr,
              match,
              teamStats
            );
            const posName = (entry.position?.displayName || '').toLowerCase();
            const isGK = posCode === 'GK' || posName.includes('goalkeeper');
            const isDEF = posCode.includes('D') || posCode.includes('B') || posName.includes('defender') || posName.includes('back');
            const isMID = posCode.includes('M') || posName.includes('midfield');
            const isFWD = posCode.includes('F') || posCode.includes('S') || posCode.includes('W') || posName.includes('forward') || posName.includes('striker') || posName.includes('winger');

            let verdict = '';
            
            if (red > 0) {
              verdict = getTemplate(templates.red, pid);
            } else if (goals > 1) {
              verdict = getTemplate(templates.brace, pid);
            } else if (goals === 1) {
              verdict = getTemplate(templates.goal, pid);
            } else if (assists > 0) {
              verdict = getTemplate(templates.assist, pid);
            } else if (yellow > 0) {
              verdict = getTemplate(templates.yellow, pid);
            } else if (mins > 0 && mins < 20) {
              verdict = getTemplate(templates.subLate, pid);
            } else if (isGK) {
              if (goalsConceded === 0) {
                verdict = getTemplate(templates.gkClean, pid).replace('{saves}', String(saves));
              } else if (saves >= 5) {
                verdict = getTemplate(templates.gkSavesHi, pid).replace('{saves}', String(saves));
              } else if (goalsConceded >= 3) {
                verdict = getTemplate(templates.gkConcededHi, pid).replace('{conceded}', String(goalsConceded));
              } else {
                verdict = getTemplate(templates.gkDefault, pid).replace('{saves}', String(saves));
              }
            } else if (isDEF) {
              if (goalsConceded === 0) {
                verdict = getTemplate(templates.defClean, pid).replace('{clearances}', String(advanced.clearances));
              } else if (goalsConceded >= 3) {
                verdict = getTemplate(templates.defHorror, pid);
              } else {
                verdict = getTemplate(templates.defSolid, pid);
              }
            } else if (isMID) {
              const hash = pid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
              if (hash % 2 === 0) {
                verdict = getTemplate(templates.midPlaymaker, pid);
              } else {
                verdict = getTemplate(templates.midCardio, pid);
              }
            } else if (isFWD) {
              const hash = pid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
              if (hash % 2 === 0) {
                verdict = getTemplate(templates.fwdQuiet, pid);
              } else {
                verdict = getTemplate(templates.fwdCardio, pid);
              }
            } else {
              verdict = getTemplate(templates.midCardio, pid);
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
