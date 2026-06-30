import fs from 'fs';
import path from 'path';

const filePath = '/Users/rajarjan/Documents/game buddy/scripts/generate-offline-verdicts.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Simplify templates to remove clearances and passing stats
const targetTemplates = `  // Defenders (CB, LB, RB, D)
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
  ],`;

const newTemplates = `  // Defenders (CB, LB, RB, D)
  defClean: [
    "Anchored the {team} backline masterfully, securing a clean sheet. {name} was an absolute rock.",
    "Defended like his life depended on it to secure a crucial clean sheet for {team}.",
    "Absolutely pocketed the opposition striker in a flawless clean sheet display by {name}.",
    "Commanding defensive display from {name}, keeping a pristine clean sheet.",
    "Put on a defensive clinic today, securing a clean sheet for {team}.",
    "A masterclass in center-back play. {name} never gave the attackers a sniff."
  ],
  defSolid: [
    "Solid defensive performance. {name} held the {team} backline together.",
    "Anchored the defense effectively under pressure for {team} today.",
    "Put in a shift at the back. {name} kept the defense organized.",
    "Reliable as ever. {name} did the dirty work and kept things tight.",
    "A stable and professional defensive performance by {name}.",
    "Kept his concentration all match. {name} kept the opposition at bay."
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
    "The puppet master in midfield for {team}. {name} dictated the tempo beautifully.",
    "Pulling all the strings in the middle. {name} kept possession ticking over nicely.",
    "Absolutely ran the show in midfield today. {name} was pure class.",
    "A midfield masterclass from {name}. Played with real maturity.",
    "Controlled the engine room. {name} dominated midfield possession today.",
    "Pure orchestration. {name} played some lovely progressive passes."
  ],
  midCardio: [
    "A quiet afternoon for {name}. Got some decent cardio in for {team} but did absolutely nothing to bother the stat sheet.",
    "Extremely safe sideways passing. {name} kept it excessively simple today.",
    "Just ran around today. {name} had a very quiet game, failing to create any real chances in 90 minutes.",
    "Spent the match passing backward. {name} took zero risks and looked happy to just float through the game.",
    "A passenger's performance in midfield. {name} was practically invisible for long stretches today.",
    "A very uninspiring afternoon in midfield for {name} today."
  ],`;

if (content.indexOf(targetTemplates) === -1) {
  console.error('Target templates not found!');
  process.exit(1);
}
content = content.replace(targetTemplates, newTemplates);

// 2. Remove derivePlayerAdvancedStats definition
const startMarker = '// Deterministic advanced stats simulator';
const endMarker = 'async function main() {';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers for derivePlayerAdvancedStats not found!');
  process.exit(1);
}

content = content.substring(0, startIndex) + content.substring(endIndex);

// 3. Remove teamStats and advanced stats calculation in main() rosters loop
const targetRostersLoop = `      const teamStats = {
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
      }`;

const newRostersLoop = `      for (const team of summary.rosters || []) {
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
              .replace(/{conceded}/g, String(goalsConceded));

            verdicts[pid] = verdict;
            count++;
          }
        }
      }`;

if (content.indexOf(targetRostersLoop) === -1) {
  console.error('Target rosters loop not found!');
  process.exit(1);
}
content = content.replace(targetRostersLoop, newRostersLoop);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Successfully updated generate-offline-verdicts.ts!');
