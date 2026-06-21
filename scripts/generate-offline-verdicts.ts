import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates = {
  brace: [
    "{name} was absolute class for {team} today. Bagged a brace and made the opposition defenders look like they were having a casual kickabout in the park.",
    "A walking cheat code in a {team} shirt. {name} grabbed two goals of pure quality that left the keeper clutching at thin air.",
    "Double trouble! {name} completely ran riot, putting two past the keeper. Liquid football at its absolute finest.",
    "Two goals of the highest order from {name}. Absolute scenes in the stadium, he had the ball on a string today.",
    "Absolutely clinical. {name} bagged a brace today and could've had a hat-trick if he wasn't feeling generous.",
    "Left the opposition chasing shadows all afternoon. Two goals of pure brilliance from {name}."
  ],
  goal: [
    "Fancy a goal, do you? {name} popped up with a clinical finish for {team} that belonged in the Louvre.",
    "Stepped up when it mattered most for {team}. {name} took his goal beautifully. Absolute quality.",
    "That is what you pay the big bucks for. {name} found the back of the net with a strike of pure class.",
    "An absolute peach of a finish from {name}. Had the keeper completely beaten before he even struck it.",
    "Cometh the hour, cometh the man. {name} fired {team} into raptures with a beautifully taken goal.",
    "Took his chance with total composure. {name} showed real striker's instinct to get on the scoresheet."
  ],
  assist: [
    "Served it up on a silver platter! {name} carved open the defense with a brilliant pass to register an assist.",
    "A lovely assist from {name} today. Pure vision to pick out his teammate in a crowded box.",
    "That pass was absolute liquid football. {name} laid it off beautifully for the assist.",
    "Unlocked the entire defense with one single pass. {name}'s vision is simply on another level.",
    "Creative genius at work. {name} set up the goal with a pass that had the defenders scratching their heads.",
    "A peach of a cross from {name} to pick out his man. Top tier service."
  ],
  red: [
    "Sent off! {name} showed Sunday League discipline at its finest. Completely bottled his temper and let {team} down.",
    "An absolute horror show of a challenge from {name} to get sent off. Enjoy the early bath, son.",
    "Lost his head completely. {name} got a straight red and can have no complaints about those walking orders.",
    "A mindless tackle that cost his team dearly. {name} is going to get a proper earful in the dressing room.",
    "Off he goes! {name} saw red after a challenge that belonged in a rugby match, not a football pitch.",
    "Absolutely bottled it. {name} left {team} in the lurch with a terrible piece of discipline."
  ],
  yellow: [
    "{name} collected a silly booking for {team}. Needs to teach his legs to tackle instead of swipe.",
    "Clumsy challenge from {name} that rightly earned him a yellow card. Playing with fire.",
    "Went into the book. {name} was far too aggressive and got a deserved yellow for his troubles.",
    "Took one for the team, or just a lazy tackle? Either way, {name} is on a tightrope now.",
    "A silly yellow card for {name}. Had no business making that challenge in the middle of the pitch.",
    "Got a yellow for a clumsy piece of defending. {name} needs to calm his boots down."
  ],
  
  // Goalkeepers
  gkClean: [
    "Absolute brick wall for {team}! {name} kept a pristine clean sheet making {saves} saves and marshaled his box with total authority.",
    "A goalkeeper's dream. {name} kept a clean sheet with {saves} saves and never looked like conceding.",
    "No way past him today. {name} kept a clean sheet with {saves} saves, showing absolute world-class reflexes.",
    "Played like he had magnets in his gloves. {name} secured the clean sheet for {team} with {saves} saves.",
    "Commanding performance between the sticks. {name} was unflappable, securing a clean sheet with {saves} saves.",
    "Kept {team} in the match and secured a clean sheet. {name} registered {saves} saves in a flawless display."
  ],
  gkSavesHi: [
    "Practically parked a double-decker bus in front of the goal. {name} made {saves} heroic saves for {team} today.",
    "Faced a proper onslaught from the opposition but stood tall with {saves} saves today. Exceptional stuff from {name}.",
    "Under constant siege but kept fighting. {name} racked up {saves} saves to keep the scoreline respectable.",
    "Unbelievable reflexes! {name} made {saves} saves to deny the opposition time and time again.",
    "The only player who can hold his head high. {name} registered {saves} saves in a stellar individual performance.",
    "A busy afternoon for {name}, who pulled off {saves} saves to keep his team in the contest."
  ],
  gkConcededHi: [
    "A miserable day between the sticks for {name}. Conceded {conceded} goals and looked completely exposed.",
    "{name} spent more time fishing the ball out of his own net than making saves, conceding {conceded} goals for {team}.",
    "An absolute nightmare afternoon. {name} leaked {conceded} goals as the defense completely vanished in front of him.",
    "Sieved {conceded} goals today. {name} looked shell-shocked and lacked any help from his backline.",
    "A horror show. Conceded {conceded} goals and will want to forget this match as quickly as possible.",
    "No protection whatsoever. {name} shipped {conceded} goals and looked completely dejected out there."
  ],
  gkDefault: [
    "{name} made {saves} saves today but couldn't prevent conceding. A tough afternoon for the {team} keeper.",
    "Did what he could between the sticks, registering {saves} saves in a busy match for {name}.",
    "Beaten today but still registered {saves} saves. {name} fought hard but was let down by his defense.",
    "Pulled off {saves} saves, but ultimately couldn't keep a clean sheet. Decent effort from {name}.",
    "Registered {saves} saves. {name} had some good moments but will be disappointed to concede.",
    "A mixed day for {name}. Conceded but still contributed {saves} saves to keep the score down."
  ],

  // Defenders (CB, LB, RB, D)
  defClean: [
    "Anchored the {team} backline masterfully, securing a clean sheet with {clearances} clearances. {name} was an absolute rock.",
    "Defended like his life depended on it. {name} registered {clearances} clearances to secure a crucial clean sheet.",
    "Absolutely pocketed the opposition striker. {name} made {clearances} clearances in a flawless clean sheet display.",
    "Commanding defensive display from {name}. Recorded {clearances} clearances and kept a pristine clean sheet.",
    "Put on a defensive clinic today. {name} secured a clean sheet for {team} with {clearances} clearances.",
    "A masterclass in center-back play. {name} cleared the ball {clearances} times and never gave the attackers a sniff."
  ],
  defSolid: [
    "Solid defensive performance. {name} held the {team} backline together with {clearances} clearances.",
    "Anchored the defense effectively under pressure, registering {clearances} clearances for {team} today.",
    "Put in a shift at the back. {name} made {clearances} clearances and kept the defense organized.",
    "Reliable as ever. {name} did the dirty work with {clearances} clearances and kept things tight.",
    "A stable and professional defensive performance by {name}, logging {clearances} clearances.",
    "Kept his concentration all match. {name} registered {clearances} clearances to keep the opposition at bay."
  ],
  defHorror: [
    "Had an absolute horror show at the back as {team} was sliced open like cheap cheese. Sunday League defending from {name}.",
    "Completely bottled it defensively today. {name} was caught ball-watching way too many times.",
    "A defensive disasterclass. {name} looked completely out of his depth and was beaten far too easily.",
    "Chasing shadows all afternoon. {name} had a shocker at the back and couldn't cope with the pace.",
    "Left his defensive duties in the changing room. A very poor showing from {name}.",
    "Gifted the opposition far too much space. {name} was a liability in defense today."
  ],

  // Midfielders (M, CM, DM, AM, LM, RM)
  midPlaymaker: [
    "The puppet master in midfield for {team}. {name} dictated the tempo with {passingAccuracy}% passing accuracy.",
    "Pulling all the strings in the middle. {name} kept possession ticking over with {passingAccuracy}% passing accuracy.",
    "Absolutely ran the show in midfield today. {name} was class, completing {passesCompleted}/{passesAttempted} passes.",
    "A midfield masterclass from {name}. Played with real maturity, logging a clean {passingAccuracy}% passing accuracy.",
    "Controlled the engine room. {name} dominated midfield possession, completing {passesCompleted} passes.",
    "Pure orchestration. {name} played some lovely progressive passes with {passingAccuracy}% accuracy."
  ],
  midCardio: [
    "A quiet afternoon for {name}. Got some decent cardio in for {team} but did absolutely nothing to bother the stat sheet.",
    "Sideways passing that would put a caffeine addict to sleep. {name} kept it excessively safe with a boring {passingAccuracy}% accuracy.",
    "Just ran around today. {name} had a very quiet game, failing to create any real chances in 90 minutes.",
    "Spent the match passing backward. {name} took zero risks and looked happy to just float through the game.",
    "A passenger's performance in midfield. {name} was practically invisible for long stretches today.",
    "Registered {passesAttempted} passes but none of them went forward. {name} had a very uninspiring afternoon."
  ],

  // Forwards (F, ST, CF, LW, RW)
  fwdQuiet: [
    "Isolated and starved of service today. {name} looked like a lonely figure upfront for {team}.",
    "Couldn't find his shooting boots. {name} was kept extremely quiet by the opposition's center-backs.",
    "Frustrating afternoon upfront. {name} struggled to get any service and ended up chasing loose balls.",
    "Completely marked out of the game. {name} didn't get a single clear opportunity all match.",
    "A quiet game upfront. {name} had to drop deep just to get a touch of the ball.",
    "Struggled to make an impact. {name} was starved of quality crosses and cut a frustrated figure."
  ],
  fwdCardio: [
    "Had a quiet afternoon upfront. {name} got his running in for {team} but failed to register a shot on target.",
    "Spent 90 minutes chasing shadows. {name} needs to get much more involved in the build-up play.",
    "A massive cardio session for {name} upfront, registering {shots} shots and zero threat.",
    "Ran his socks off but with zero end product. {name} failed to test the goalkeeper today.",
    "A toothless performance in attack. {name} worked hard but lacked any cutting edge.",
    "Zero service and zero shots on target. {name} spent more time tracking back than attacking."
  ],

  subLate: [
    "Subbed on late to run the clock down. {name} took home a match bonus for breathing the stadium air.",
    "Came on to get some grass on his boots. {name} barely had time to break a sweat for {team}.",
    "A brief cameo. {name} came on for the final few minutes to help see the game out.",
    "Subbed on late. Not enough time for {name} to make a meaningful impact, but got some run in.",
    "A late introduction to give a teammate a breather. {name} did his job in a short cameo.",
    "Late sub appearance. {name} got a quick run-out but the match was already settled."
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

            let templateText = '';
            
            if (red > 0) {
              templateText = getTemplate(templates.red, pid);
            } else if (goals > 1) {
              templateText = getTemplate(templates.brace, pid);
            } else if (goals === 1) {
              templateText = getTemplate(templates.goal, pid);
            } else if (assists > 0) {
              templateText = getTemplate(templates.assist, pid);
            } else if (yellow > 0) {
              templateText = getTemplate(templates.yellow, pid);
            } else if (mins > 0 && mins < 20) {
              templateText = getTemplate(templates.subLate, pid);
            } else if (isGK) {
              if (goalsConceded === 0) {
                templateText = getTemplate(templates.gkClean, pid);
              } else if (saves >= 5) {
                templateText = getTemplate(templates.gkSavesHi, pid);
              } else if (goalsConceded >= 3) {
                templateText = getTemplate(templates.gkConcededHi, pid);
              } else {
                templateText = getTemplate(templates.gkDefault, pid);
              }
            } else if (isDEF) {
              if (goalsConceded === 0) {
                templateText = getTemplate(templates.defClean, pid);
              } else if (goalsConceded >= 3) {
                templateText = getTemplate(templates.defHorror, pid);
              } else {
                templateText = getTemplate(templates.defSolid, pid);
              }
            } else if (isMID) {
              const hash = pid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
              if (hash % 2 === 0) {
                templateText = getTemplate(templates.midPlaymaker, pid);
              } else {
                templateText = getTemplate(templates.midCardio, pid);
              }
            } else if (isFWD) {
              const hash = pid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
              if (hash % 2 === 0) {
                templateText = getTemplate(templates.fwdQuiet, pid);
              } else {
                templateText = getTemplate(templates.fwdCardio, pid);
              }
            } else {
              templateText = getTemplate(templates.midCardio, pid);
            }

            const name = ath.displayName || ath.fullName || 'Unknown Player';
            const verdict = templateText
              .replace(/{name}/g, name)
              .replace(/{team}/g, teamAbbr)
              .replace(/{goals}/g, String(goals))
              .replace(/{assists}/g, String(assists))
              .replace(/{shots}/g, String(getVal('totalShots')))
              .replace(/{saves}/g, String(saves))
              .replace(/{conceded}/g, String(goalsConceded))
              .replace(/{clearances}/g, String(advanced.clearances))
              .replace(/{passingAccuracy}/g, String(advanced.passingAccuracy))
              .replace(/{passesCompleted}/g, String(advanced.passesCompleted))
              .replace(/{passesAttempted}/g, String(advanced.passesAttempted));

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
