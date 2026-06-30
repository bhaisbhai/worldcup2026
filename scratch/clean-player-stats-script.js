import fs from 'fs';
import path from 'path';

const filePath = '/Users/rajarjan/Documents/game buddy/scripts/generate-player-stats.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Update PlayerStats interface
const targetInterface = `interface PlayerStats {
  name: string;
  teamName: string;
  teamAbbr: string;
  appearances: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  minutesPlayed: number;
  clearances: number;
  passesCompleted: number;
  passesAttempted: number;
  cleanSheets: number;
  headshot?: string;
}`;

const newInterface = `interface PlayerStats {
  name: string;
  teamName: string;
  teamAbbr: string;
  appearances: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  minutesPlayed: number;
  headshot?: string;
}`;

if (content.indexOf(targetInterface) === -1) {
  console.error('Target interface not found!');
  process.exit(1);
}
content = content.replace(targetInterface, newInterface);

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

// 3. Remove teamStats calculation and derivePlayerAdvancedStats calls in main()
const targetMainBlock = `      const teamStats = {
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
          const id = String(ath.id || '');
          if (!id) continue;

          const stats: any[] = entry.stats || [];
          const sv = (name: string) => {
            const s = stats.find((x: any) => x.name === name);
            return s ? (parseFloat(String(s.value)) || 0) : 0;
          };

          const mins = sv('minutesPlayed');
          if (entry.starter === true || mins > 0) {
            const posCode = entry.position?.abbreviation || '';
            const advanced = derivePlayerAdvancedStats(
              id,
              posCode,
              mins,
              teamAbbr,
              matchMeta,
              teamStats
            );

            if (!playerStats[id]) {
              playerStats[id] = {
                name: ath.displayName || ath.fullName || '',
                teamName: team.team?.displayName || '',
                teamAbbr: team.team?.abbreviation || '',
                appearances: 0,
                goals: 0,
                assists: 0,
                shots: 0,
                shotsOnTarget: 0,
                saves: 0,
                yellowCards: 0,
                redCards: 0,
                minutesPlayed: 0,
                clearances: 0,
                passesCompleted: 0,
                passesAttempted: 0,
                cleanSheets: 0,
              };
              const hs = ath.headshot?.href || ath.headshot;
              if (hs) playerStats[id].headshot = hs;
            }

            playerStats[id].appearances++;
            playerStats[id].goals        += sv('totalGoals');
            playerStats[id].assists      += sv('goalAssists');
            playerStats[id].shots        += sv('totalShots');
            playerStats[id].shotsOnTarget+= sv('shotsOnTarget');
            playerStats[id].saves        += sv('saves');
            playerStats[id].yellowCards  += sv('yellowCards');
            playerStats[id].redCards     += sv('redCards');
            playerStats[id].minutesPlayed+= mins;
            playerStats[id].clearances   += advanced.clearances;
            playerStats[id].passesCompleted += advanced.passesCompleted;
            playerStats[id].passesAttempted += advanced.passesAttempted;
            if (advanced.cleanSheet) {
              playerStats[id].cleanSheets++;
            }
          }
        }
      }`;

const newMainBlock = `      for (const team of summary.rosters || []) {
        const teamAbbr = team.team?.abbreviation || '';
        for (const entry of team.roster || []) {
          const ath = entry.athlete || {};
          const id = String(ath.id || '');
          if (!id) continue;

          const stats: any[] = entry.stats || [];
          const sv = (name: string) => {
            const s = stats.find((x: any) => x.name === name);
            return s ? (parseFloat(String(s.value)) || 0) : 0;
          };

          const mins = sv('minutesPlayed');
          if (entry.starter === true || mins > 0) {
            if (!playerStats[id]) {
              playerStats[id] = {
                name: ath.displayName || ath.fullName || '',
                teamName: team.team?.displayName || '',
                teamAbbr: team.team?.abbreviation || '',
                appearances: 0,
                goals: 0,
                assists: 0,
                shots: 0,
                shotsOnTarget: 0,
                saves: 0,
                yellowCards: 0,
                redCards: 0,
                minutesPlayed: 0,
              };
              const hs = ath.headshot?.href || ath.headshot;
              if (hs) playerStats[id].headshot = hs;
            }

            playerStats[id].appearances++;
            playerStats[id].goals        += sv('totalGoals');
            playerStats[id].assists      += sv('goalAssists');
            playerStats[id].shots        += sv('totalShots');
            playerStats[id].shotsOnTarget+= sv('shotsOnTarget');
            playerStats[id].saves        += sv('saves');
            playerStats[id].yellowCards  += sv('yellowCards');
            playerStats[id].redCards     += sv('redCards');
            playerStats[id].minutesPlayed+= mins;
          }
        }
      }`;

if (content.indexOf(targetMainBlock) === -1) {
  console.error('Target main block not found!');
  process.exit(1);
}
content = content.replace(targetMainBlock, newMainBlock);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Successfully updated generate-player-stats.ts!');
