const fs = require('fs');
const path = require('path');

const masterPath = path.resolve(__dirname, '..', 'public', 'assets', 'ai', 'ai_master.json');
if (!fs.existsSync(masterPath)) {
  console.error("❌ master JSON does not exist!");
  process.exit(1);
}

const masterDB = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
const espnMatches = masterDB.espnMatches || {};
const teams = masterDB.teams || {};
const days = masterDB.days || {};
const espnStandings = masterDB.espnStandings || [];

// Populate all valid team codes and names from espnStandings (all 48 teams)
const allTeamCodes = new Set();
const teamNames = {};

for (const group of espnStandings) {
  for (const t of group.teams || []) {
    if (t.code) {
      allTeamCodes.add(t.code);
      teamNames[t.code] = t.name;
    }
  }
}

// Add common countries that might be hallucinated even if not in standings
const externalCountries = [
  "DENMARK", "ITALY", "SWEDEN", "NORWAY", "SCOTLAND", "ENGLAND", "GERMANY",
  "FRANCE", "SPAIN", "PORTUGAL", "BRAZIL", "ARGENTINA", "NETHERLANDS", "BELGIUM",
  "CROATIA", "MOROCCO", "TUNISIA", "JAPAN", "KOREA", "MEXICO", "USA", "CANADA"
];

// Build match history for each team
const teamHistory = {};
for (const date of Object.keys(espnMatches)) {
  for (const match of espnMatches[date] || []) {
    const isCompleted = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FULL_TIME';
    if (!isCompleted) continue;
    
    const h = match.homeTeam;
    const a = match.awayTeam;
    if (!teamHistory[h]) teamHistory[h] = new Set();
    if (!teamHistory[a]) teamHistory[a] = new Set();
    
    teamHistory[h].add(a);
    teamHistory[a].add(h);
  }
}

let failures = 0;

console.log("🔍 Checking team summaries for opponent/match hallucinations...");
for (const code of Object.keys(teams)) {
  const t = teams[code];
  const history = teamHistory[code] || new Set();
  const name = teamNames[code] || code;

  // Use original mixed-case text to scan for uppercase standalone codes
  const originalText = `${t.headline} ${t.storySoFar} ${t.whatsNext} ${t.pubAmmo}`;
  const textToScanUpper = originalText.toUpperCase();

  // Find 3-letter standalone uppercase codes mentioned in the summary
  const matches = originalText.match(/\b[A-Z]{3}\b/g) || [];
  for (const match of matches) {
    if (match === code) continue; // Mentioning themselves is fine
    if (allTeamCodes.has(match)) {
      if (!history.has(match)) {
        console.warn(`⚠️ Team ${code} (${name}) summary mentions team code ${match}, but they did not play each other!`);
        failures++;
      }
    }
  }

  // Also check for full name mentions of other teams they didn't play (both in tournament and common external ones)
  for (const c of Object.keys(teamNames)) {
    if (c === code) continue;
    const opponentName = teamNames[c].toUpperCase();
    if (textToScanUpper.includes(opponentName)) {
      if (!history.has(c)) {
        console.warn(`⚠️ Team ${code} (${name}) summary mentions team name "${teamNames[c]}" (${c}), but they did not play each other!`);
        failures++;
      }
    }
  }

  // Check for external country names
  for (const country of externalCountries) {
    if (country === code || country === name.toUpperCase() || name.toUpperCase().includes(country) || country.includes(name.toUpperCase())) continue;
    let playedThisCountry = false;
    for (const oppCode of history) {
      const oppName = (teamNames[oppCode] || "").toUpperCase();
      if (oppCode === country || oppName.includes(country) || country.includes(oppName)) {
        playedThisCountry = true;
      }
    }
    if (textToScanUpper.includes(country) && !playedThisCountry) {
      // Don't warn for historical/general references if they are just about general history (like Scotland never qualifying)
      if (country === "SCOTLAND" && textToScanUpper.includes("NEVER ONCE MADE IT PAST THE FIRST ROUND")) continue;
      
      console.warn(`⚠️ Team ${code} (${name}) summary mentions country "${country}", but they did not play each other in this tournament!`);
      failures++;
    }
  }

  // Check if they only played 1 match, but text says they played multiple games
  const matchCount = history.size;
  if (matchCount === 1) {
    const lowerText = textToScanUpper.toLowerCase();
    if (lowerText.includes("three games") || 
        lowerText.includes("3 games") || 
        lowerText.includes("perfect record") || 
        lowerText.includes("two wins") ||
        lowerText.includes("2 wins") ||
        lowerText.includes("both games") ||
        lowerText.includes("both matches") ||
        lowerText.includes("two matches") ||
        lowerText.includes("2 matches")) {
      console.warn(`⚠️ Team ${code} (${name}) only played 1 match, but summary text suggests multiple games!`);
      failures++;
    }
  }
}

console.log("\n🔍 Checking daily summaries for qualification/elimination hallucinations...");
for (const date of Object.keys(days).sort()) {
  const daySummary = days[date];
  const text = `${daySummary.headline} ${daySummary.theDrama} ${daySummary.mustWatchHighlights} ${daySummary.progressionNews}`.toLowerCase();

  const teamStandingsMap = new Map();
  const groupTeamsMap = new Map();
  const completedMatches = [];

  // Initialize group and team mappings
  espnStandings.forEach((g, gIdx) => {
    const gName = g.group || `Group ${gIdx + 1}`;
    const codes = [];
    for (const t of g.teams || []) {
      const code = t.code;
      if (!code) continue;
      teamStandingsMap.set(code, {
        code,
        name: t.name,
        group: gName,
        mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, gd: 0
      });
      codes.push(code);
    }
    groupTeamsMap.set(gName, codes);
  });

  // Collect all completed matches up to date
  for (const d of Object.keys(espnMatches)) {
    if (d > date) continue;
    for (const m of espnMatches[d] || []) {
      const isCompleted = m.status === 'STATUS_FINAL' || m.status === 'STATUS_FULL_TIME';
      if (!isCompleted) continue;

      const h = teamStandingsMap.get(m.homeTeam);
      const a = teamStandingsMap.get(m.awayTeam);
      if (h && a && h.group === a.group) {
        completedMatches.push({
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore
        });
      }
    }
  }

  // Update standings using completed matches
  for (const match of completedMatches) {
    const home = teamStandingsMap.get(match.homeTeam);
    const away = teamStandingsMap.get(match.awayTeam);
    if (home) {
      home.mp += 1;
      home.gf += match.homeScore;
      home.ga += match.awayScore;
      home.gd = home.gf - home.ga;
      if (match.homeScore > match.awayScore) { home.w += 1; home.pts += 3; }
      else if (match.homeScore === match.awayScore) { home.d += 1; home.pts += 1; }
      else { home.l += 1; }
    }
    if (away) {
      away.mp += 1;
      away.gf += match.awayScore;
      away.ga += match.homeScore;
      away.gd = away.gf - away.ga;
      if (match.awayScore > match.homeScore) { away.w += 1; away.pts += 3; }
      else if (match.awayScore === match.homeScore) { away.d += 1; away.pts += 1; }
      else { away.l += 1; }
    }
  }

  // Check each team's computed status
  for (const [gName, codes] of groupTeamsMap) {
    const entries = codes
      .map(code => teamStandingsMap.get(code))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    entries.forEach(t => {
      let isEliminated = false;
      let isQualified = false;

      if (t.mp === 3) {
        const pos = entries.findIndex(x => x.code === t.code) + 1;
        if (pos <= 2) isQualified = true;
        else if (pos === 3) {
          if (t.pts >= 4) {
            // Possible best-3rd
          } else {
            isEliminated = true;
          }
        } else {
          isEliminated = true;
        }
      }

      const teamName = t.name.toLowerCase();
      
      // If team is NOT eliminated, check if summary says they are eliminated
      if (!isEliminated) {
        if (text.includes(`${teamName} is eliminated`) || 
            text.includes(`${teamName} are eliminated`) || 
            text.includes(`${teamName} eliminated`) ||
            text.includes(`${t.code.toLowerCase()} is eliminated`) ||
            text.includes(`${t.code.toLowerCase()} are eliminated`)) {
          console.warn(`⚠️ Date ${date} summary claims ${t.code} (${t.name}) is eliminated, but they are still in contention (P${t.mp} Pts${t.pts})!`);
          failures++;
        }
      }

      // If team is NOT qualified, check if summary says they qualified
      if (!isQualified) {
        if (text.includes(`${teamName} qualified`) || 
            text.includes(`${teamName} has qualified`) || 
            text.includes(`${teamName} have qualified`) ||
            text.includes(`${t.code.toLowerCase()} qualified`) ||
            text.includes(`${t.code.toLowerCase()} has qualified`)) {
          console.warn(`⚠️ Date ${date} summary claims ${t.code} (${t.name}) qualified, but they have not secured a spot (P${t.mp} Pts${t.pts})!`);
          failures++;
        }
      }
    });
  }
}



console.log("\n🔍 Checking match summaries for score mismatches, formatting, and structure...");
const matchSummaries = masterDB.matches || {};

// Build a flat list of completed matches from ESPN for easy lookup
const espnMatchMap = {};
for (const date of Object.keys(espnMatches)) {
  for (const m of espnMatches[date] || []) {
    const isCompleted = m.status === 'STATUS_FINAL' || m.status === 'STATUS_FULL_TIME';
    if (!isCompleted) continue;
    const key = `${m.homeTeam}-${m.awayTeam}`;
    espnMatchMap[key] = m;
  }
}

for (const key of Object.keys(matchSummaries)) {
  const mSummary = matchSummaries[key];
  const realMatch = espnMatchMap[key];

  if (!realMatch) {
    console.warn(`⚠️ Match summary exists for key "${key}", but no completed match found in espnMatches!`);
    failures++;
    continue;
  }

  // 1. Check title casing
  if (mSummary.editionTitle !== mSummary.editionTitle.toUpperCase()) {
    console.warn(`⚠️ Match ${key} title "${mSummary.editionTitle}" is not ALL CAPS!`);
    failures++;
  }

  // 2. Check talking points count
  if (!Array.isArray(mSummary.talkingPoints) || mSummary.talkingPoints.length !== 3) {
    console.warn(`⚠️ Match ${key} has ${mSummary.talkingPoints ? mSummary.talkingPoints.length : 0} talking points, expected exactly 3!`);
    failures++;
  }

  // 3. Score validation: check that any score mentioned in the summary matches the actual score
  const summaryText = `${mSummary.snappySummary} ${mSummary.talkingPoints.join(' ')} ${mSummary.randomQuirk}`;
  const scoresInText = summaryText.match(/\b\d+-\d+\b/g) || [];
  
  const expectedScore1 = `${realMatch.homeScore}-${realMatch.awayScore}`;
  const expectedScore2 = `${realMatch.awayScore}-${realMatch.homeScore}`;

  const finalScoreMentioned = summaryText.includes(expectedScore1) || summaryText.includes(expectedScore2);

  if (!finalScoreMentioned) {
    console.warn(`⚠️ Match ${key} summary does not mention the actual final score of ${expectedScore1}!`);
    failures++;
  }


  // 4. Verify no hallucinated events (e.g. defender kicking ball into teammate's face or kilt reader upside down)
  const lowerSummary = summaryText.toLowerCase();
  if (lowerSummary.includes("teammate's face") || lowerSummary.includes("kicked in the face") || lowerSummary.includes("kicked by the ball") || lowerSummary.includes("teammates face")) {
    console.warn(`⚠️ Match ${key} summary contains the "teammate's face" hallucination!`);
    failures++;
  }
  if (lowerSummary.includes("upside-down") || lowerSummary.includes("reading a tactical guidebook")) {
    console.warn(`⚠️ Match ${key} summary contains the "upside-down guidebook" hallucination!`);
    failures++;
  }
}

if (failures === 0) {
  console.log("\n✅ Programmatic check passed! No obvious hallucinations detected.");
} else {
  console.warn(`\n❌ Found ${failures} potential warnings/hallucinations in the current summaries.`);
}

