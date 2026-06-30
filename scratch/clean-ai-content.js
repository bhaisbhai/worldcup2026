import fs from 'fs';
import path from 'path';

const filePath = '/Users/rajarjan/Documents/game buddy/scripts/generate-ai-content.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Remove derivePlayerAdvancedStats definition
const startMarker = '// Deterministic advanced stats simulator';
const endMarker = '// Main execution function';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers for derivePlayerAdvancedStats definition not found!');
  process.exit(1);
}

content = content.substring(0, startIndex) + content.substring(endIndex);

// 2. Remove advanced stats collection from rosters loop in main()
const targetRostersLoop = `              const advanced = derivePlayerAdvancedStats(
                playerId,
                posCode,
                mins,
                teamAbbr,
                realMatchMeta,
                parsedStats
              );

              playersWhoPlayed.push({
                id: playerId,
                name: ath.displayName || ath.fullName || 'Unknown Player',
                team: teamAbbr,
                stats: {
                  goals: getVal('totalGoals'),
                  assists: getVal('goalAssists'),
                  shots: getVal('totalShots'),
                  saves: getVal('saves'),
                  yellowCards: getVal('yellowCards'),
                  redCards: getVal('redCards'),
                  minutesPlayed: mins,
                  clearances: advanced.clearances,
                  passesCompleted: advanced.passesCompleted,
                  passesAttempted: advanced.passesAttempted,
                  passingAccuracy: advanced.passingAccuracy,
                  cleanSheet: advanced.cleanSheet ? 1 : 0
                }
              });`;

const newRostersLoop = `              playersWhoPlayed.push({
                id: playerId,
                name: ath.displayName || ath.fullName || 'Unknown Player',
                team: teamAbbr,
                stats: {
                  goals: getVal('totalGoals'),
                  assists: getVal('goalAssists'),
                  shots: getVal('totalShots'),
                  saves: getVal('saves'),
                  yellowCards: getVal('yellowCards'),
                  redCards: getVal('redCards'),
                  minutesPlayed: mins
                }
              });`;

if (content.indexOf(targetRostersLoop) === -1) {
  console.error('Target rosters loop not found!');
  process.exit(1);
}
content = content.replace(targetRostersLoop, newRostersLoop);

// 3. Update the players list prompt string
const targetPlayersListStr = `    const playersListStr = playersWhoPlayed.map(p => 
      \`- \${p.name} (Team: \${p.team}, ID: \${p.id}): played \${p.stats.minutesPlayed} mins, Goals: \${p.stats.goals}, Assists: \${p.stats.assists}, Shots: \${p.stats.shots}, Saves: \${p.stats.saves}, Clearances: \${p.stats.clearances || 0}, Passing Accuracy: \${p.stats.passingAccuracy || 0}% (\${p.stats.passesCompleted || 0}/\${p.stats.passesAttempted || 0} passes), Clean Sheet: \${p.stats.cleanSheet === 1 ? 'Yes' : 'No'}, Yellows: \${p.stats.yellowCards}, Reds: \${p.stats.redCards}\`
    ).join('\\n');`;

const newPlayersListStr = `    const playersListStr = playersWhoPlayed.map(p => 
      \`- \${p.name} (Team: \${p.team}, ID: \${p.id}): played \${p.stats.minutesPlayed} mins, Goals: \${p.stats.goals}, Assists: \${p.stats.assists}, Shots: \${p.stats.shots}, Saves: \${p.stats.saves}, Yellows: \${p.stats.yellowCards}, Reds: \${p.stats.redCards}\`
    ).join('\\n');`;

if (content.indexOf(targetPlayersListStr) === -1) {
  console.error('Target players list string not found!');
  process.exit(1);
}
content = content.replace(targetPlayersListStr, newPlayersListStr);

// 4. Update prompt instructions on clearances/passing
const targetInstructions = `  - If a defender/outfield player had a high number of clearances (e.g. 5+ clearances) or exceptional passing accuracy (e.g. 95%): highlight/comment on their solid distribution or defensive work.
  - If a player had 0 goals/assists/shots/clearances despite playing 90 minutes: mock them for getting a cardio session in.
  - If a goalkeeper kept a clean sheet or made many saves: praise their heroic brick wall, or mock their defense.
- REFER to the actual statistics provided (e.g. their passing accuracy, clearances, saves) inside your witty verdict to anchor it to reality!`;

const newInstructions = `  - If a player had 0 goals/assists/shots/saves despite playing 90 minutes: mock them for getting a cardio session in.
  - If a goalkeeper made many saves: praise their heroic brick wall, or mock their defense.
- REFER to the actual statistics provided (e.g. their goals, assists, saves, cards) inside your witty verdict to anchor it to reality!`;

if (content.indexOf(targetInstructions) === -1) {
  console.error('Target instructions not found!');
  process.exit(1);
}
content = content.replace(targetInstructions, newInstructions);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Successfully updated generate-ai-content.ts!');
