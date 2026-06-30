import fs from 'fs';
import path from 'path';

const indexPath = '/Users/rajarjan/Documents/game buddy/index.html';
let content = fs.readFileSync(indexPath, 'utf-8');

// 1. Remove derivePlayerAdvancedStats
const startMarker = '// Deterministic advanced stats simulator';
const endMarker = 'function openPlayerDetail(athleteId){';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found!');
  process.exit(1);
}

const replacement1 = `const PLAYER_STAT_WANT = {
  totalGoals: 'Goals',
  goalAssists: 'Assists',
  totalShots: 'Shots',
  shotsOnTarget: 'On Target',
  saves: 'Saves',
  yellowCards: 'Yellow',
  redCards: 'Red',
  foulsCommitted: 'Fouls',
  offsides: 'Offsides',
};

function extractMatchStats(athleteId, data, ev) {
  if (!data || !ev) return [];
  for (const team of data?.rosters || []) {
    const p = (team.roster || []).find(e => String(e.athlete?.id) === String(athleteId));
    if (!p) continue;

    const statsMap = {};
    (p.stats || []).forEach(s => {
      if (s.value > 0) statsMap[s.name] = s.displayValue || String(s.value);
    });

    const out = [];
    for (const [key, label] of Object.entries(PLAYER_STAT_WANT)) {
      if (statsMap[key]) {
        out.push({ lbl: label, val: statsMap[key] });
      }
    }
    return out;
  }
  return [];
}

`;

content = content.substring(0, startIndex) + replacement1 + content.substring(endIndex);

// 2. Remove advanced stats from profile render block
const targetBlock = `    const PSMAP=[['appearances','Apps'],['goals','Goals'],['assists','Assists'],['minutesPlayed','Mins'],
      ['shots','Shots'],['saves','Saves'],['cleanSheets','Clean Sheets'],['clearances','Clearances']];
    tournStats=PSMAP.map(([k,l])=>{const v=ps[k];return(v!=null&&v>0)?{lbl:l,val:String(v)}:null;}).filter(Boolean);

    // Add passing accuracy
    if (ps.passesAttempted > 0) {
      const passPct = Math.round((ps.passesCompleted / ps.passesAttempted) * 100);
      tournStats.push({ lbl: 'Pass %', val: \`\${passPct}%\` });
    }
    
    // Add yellow/red cards
    if (ps.yellowCards > 0) tournStats.push({ lbl: 'Yellow', val: String(ps.yellowCards) });
    if (ps.redCards > 0) tournStats.push({ lbl: 'Red', val: String(ps.redCards) });`;

const replacement2 = `    const PSMAP=[['appearances','Apps'],['goals','Goals'],['assists','Assists'],['minutesPlayed','Mins'],
      ['shots','Shots'],['saves','Saves']];
    tournStats=PSMAP.map(([k,l])=>{const v=ps[k];return(v!=null&&v>0)?{lbl:l,val:String(v)}:null;}).filter(Boolean);
    
    // Add yellow/red cards
    if (ps.yellowCards > 0) tournStats.push({ lbl: 'Yellow', val: String(ps.yellowCards) });
    if (ps.redCards > 0) tournStats.push({ lbl: 'Red', val: String(ps.redCards) });`;

if (content.indexOf(targetBlock) === -1) {
  console.error('Target block 2 not found!');
  process.exit(1);
}

content = content.replace(targetBlock, replacement2);

fs.writeFileSync(indexPath, content, 'utf-8');
console.log('Successfully updated index.html for both parts!');
