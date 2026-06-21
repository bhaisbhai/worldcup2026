import * as fs from 'fs';
import * as path from 'path';

// Helper to parse CSV strings, including quoted text and double-quote escaping
function parseCSV(csvContent: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentVal += '"';
          i++; // Skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(currentVal.trim());
        currentVal = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        row.push(currentVal.trim());
        if (row.some(val => val !== '') || currentVal !== '') {
          lines.push(row);
        }
        row = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
  }
  if (row.length > 0 || currentVal !== '') {
    row.push(currentVal.trim());
    lines.push(row);
  }
  return lines;
}

// 1. Raw CSV Data for Teams
// Format: teamId, headline, storySoFar, whatsNext, pubAmmo
const rawTeamsCSV = `teamId,headline,storySoFar,whatsNext,pubAmmo
BIH,"The Defensive Circus","Scraped a point against Canada, but absolutely imploded against Switzerland. Two yellows and a straight red in a 20-minute spell turned their defense into a circus in a 4-1 loss.","Need to figure out how to keep 11 men on the pitch if they want any realistic chance of progression.","Did you know Bosnia managed to tackle themselves out of the Switzerland game by collecting three cards between the 59th and 80th minutes?"
ENG,"Slightly Better Than Terrible, But Barely","Scraped by on penalties against Denmark. Absolute Sunday-League coordination in the middle with sideways passing that would put a caffeine addict to sleep.","Need to stop relying on luck or they will be on the first flight home before the postcards arrive.","Did you know England have dropped more points from winning positions than any other European team in World Cup history?"
SCO,"The Bravehearts' Liquid Devastation","An absolute masterclass in tactical stubbornness. Parked a double-decker bus against Morocco, only to concede to an overhead kick that defied all laws of Scottish gravity.","Need to find a forward who can run without looking like he's wading through wet porridge.","Did you know Scotland have played in 8 World Cups and never once made it past the first round? Pain is an art form."
MAR,"Atlas Lions on the Rampage","Liquid football from the Moroccans. Slick one-touches that made the Scottish defense spin like laundry. Hakimi's cross for the winner belonged in the Louvre.","Need to tighten up the backline; they were caught sleeping twice on simple long balls.","Did you know Morocco became the first African nation to reach a World Cup semi-final, and they've kept more clean sheets than any other African team?"
USA,"Star-Spangled Swagger","Smooth control and high-intensity press. Completely rattled Australia with direct running. Christian Pulisic was a walking cheat code, dribbling past defenders as if they were training cones.","Must maintain this intensity in the knockouts; complacency is the only real enemy.","Did you know the USA's 3-0 win against Paraguay in 1930 featured the first-ever hat-trick in World Cup history by Bert Patenaude?"
AUS,"Socceroos' Squeaky Bum Time","An absolute horror show in possession. Handed the ball to the Americans on a silver platter. Completely bottled it in the second half with static defending.","Need to go back to basic passing drills and stop panicking when pressed.","Did you know Australia's nickname 'Socceroos' was coined in 1967 by a journalist named Tony Horstead?"
BRA,"Samba Style or Casual Kickabout?","Breezed past Haiti with Vinicius Jr playing like he was in his back garden. 5-0 looks good, but they missed enough sitters to warrant a stern dressing down.","Need to keep their feet on the ground and show some respect for the offside rule.","Did you know Brazil is the only country to have played in every single World Cup tournament?"
HAI,"The Philly Fryer","Absolute scenes in Philadelphia. Commendable spirit but completely outclassed. Conceded three goals from simple set-pieces which is Sunday League defending at its finest.","Need to practice defending corners unless they enjoy conceding free headers.","Did you know Haiti's 1974 World Cup squad featured Emmanuel Sanon, who scored their only two goals in the history of the tournament?"
PAR,"The Snarl and the Sweep","Paraguay's physical display contrasted heavily with Turkey's smooth control. Relentless tackling that bordered on a contact sport. Galarza scored after 64 seconds.","Need to control their tempers; three yellow cards in the second half was playing with fire.","Did you know Paraguay have reached the Round of 16 four times but only made the Quarterfinals once in 2010?"
TUR,"The Swear-O-Meter Disaster","An absolute circus. Normal service was resumed until Almiron got sent off within forty minutes for swearing at the referee, completely derailing their defensive blueprint.","Need to teach their players the international sign language for silence before the next match.","Did you know Turkey finished third in the 2002 World Cup, where Hakan Sükür scored the fastest goal in history (11 seconds)?"`;

// 2. Raw CSV Data for Matches
// Format: matchId, editionTitle, snappySummary, talkingPoints, randomQuirk
const rawMatchesCSV = `matchId,editionTitle,snappySummary,talkingPoints,randomQuirk
PAR_TUR,"THE SWEAR-O-METER DISASTER","An absolute circus. Almiron got sent off within forty minutes for swearing at the ref. Paraguay held on for a chaotic 1-0 win.","Galarza scores the opener in 64 seconds;Almiron's red card completely derailed Türkiye's defensive blueprint;Paraguay's physical display ran the clock down effectively","Almiron covering his mouth to swear at the referee, only to get caught by high-definition cameras."
SCO_MAR,"THE MOROCCAN OVERHEAD BEAUTY","Morocco danced through the Scottish midfield and claimed a deserved 2-1 victory. Scotland's late surge was too little, too late.","Morocco's liquid football carved open the Scottish double-decker bus;Conceded to an overhead kick that defied all laws of Scottish gravity;Morocco's defense stood tall under late aerial pressure","A Scottish fan in a kilt spotted reading a tactical guidebook upside-down in the 88th minute."
USA_AUS,"THE STAR-SPANGLED SWAGGER","The USA cruised to a 3-0 victory over Australia. The Socceroos looked like they were having a casual kickabout in the park.","Pulisic was a walking cheat code, scoring two and assisting one;Australia completely bottled it in possession, committing 18 turnovers;The high press from the Americans left Australia gasping for air","An Australian defender trying to clear the ball, only to kick it directly into his own teammate's face."
BRA_HAI,"THE SAMBA EXCURSION","Brazil dominated Haiti 5-0 in a match that felt like a training session. Vinicius Jr scored a hat-trick of pure class.","Vinicius Jr put on a show with three goals and endless flair;Haiti's Sunday League defending conceded three goals from simple corners;Brazil hit the post three times, preventing an even bigger scoreline","A Haitian defender asking Vinicius Jr to swap shirts during a water break in the 30th minute."`;

// 3. Raw CSV Data for Daily Recaps
// Format: date, headline, theDrama, mustWatchHighlights, progressionNews
const rawDaysCSV = `date,headline,theDrama,mustWatchHighlights,progressionNews
2026-06-19,"Chaos and Swearing Rule the Pitch","Paraguay's physical display contrasted heavily with the USA's smooth control. Scotland's double-decker bus was dismantled by Moroccan flair.","Watch Paraguay vs Turkey for the unadulterated madness. Skip Scotland vs Morocco unless you like watching paint dry.","USA officially advances to knockouts; Australia are mathematically booking flights home."`;



async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status} from ${url}`);
  }
  return await res.json();
}

async function runBackfill() {
  console.log("🚀 Starting One-Off Historical Backfill Utility...");

  const parsedTeams = parseCSV(rawTeamsCSV);
  const parsedMatches = parseCSV(rawMatchesCSV);
  const parsedDays = parseCSV(rawDaysCSV);

  const masterDB: any = {
    lastUpdated: new Date().toISOString(),
    teams: {},
    matches: {},
    days: {},
    today_preview: {
      headline: "The Battle of the Heavyweights Awaits",
      theBigOnes: "Germany faces Ivory Coast in a crucial Group E clash. Netherlands takes on Sweden in Group F.",
      playersToWatch: "Look out for Jamal Musiala's direct runs and Sweden's Alexander Isak on the counter.",
      firstKickoffTime: "2026-06-20T18:00:00Z"
    },
    espnMatches: {},
    espnStandings: []
  };

  // 1. Process Teams (Skip header row)
  for (let i = 1; i < parsedTeams.length; i++) {
    const row = parsedTeams[i];
    if (row.length < 5) continue;
    const [teamId, headline, storySoFar, whatsNext, pubAmmo] = row;
    masterDB.teams[teamId] = {
      headline,
      storySoFar,
      whatsNext,
      pubAmmo
    };
  }
  console.log(`✅ Processed ${Object.keys(masterDB.teams).length} Teams.`);

  // 2. Process Matches (Skip header row)
  for (let i = 1; i < parsedMatches.length; i++) {
    const row = parsedMatches[i];
    if (row.length < 5) continue;
    const [matchId, editionTitle, snappySummary, talkingPointsStr, randomQuirk] = row;
    
    // Normalize team key from PAR_TUR to PAR-TUR
    const normalizedKey = matchId.replace('_', '-');
    
    // Split talking points by semicolon
    const talkingPoints = talkingPointsStr.split(';').map(p => p.trim()).filter(Boolean);

    masterDB.matches[normalizedKey] = {
      editionTitle,
      snappySummary,
      talkingPoints,
      randomQuirk
    };
  }
  console.log(`✅ Processed ${Object.keys(masterDB.matches).length} Matches.`);

  // 3. Process Days (Skip header row)
  for (let i = 1; i < parsedDays.length; i++) {
    const row = parsedDays[i];
    if (row.length < 5) continue;
    const [date, headline, theDrama, mustWatchHighlights, progressionNews] = row;
    masterDB.days[date] = {
      headline,
      theDrama,
      mustWatchHighlights,
      progressionNews
    };
  }
  console.log(`✅ Processed ${Object.keys(masterDB.days).length} Day Recaps.`);

  // 4. Fetch ESPN Match Data from June 11 to June 20, 2026
  console.log(`⚽ Fetching historical match data from ESPN for June 11-20, 2026...`);
  for (let day = 11; day <= 20; day++) {
    const dateStr = `2026-06-${day}`;
    const dateFormatted = `202606${day}`;
    masterDB.espnMatches[dateStr] = [];

    try {
      const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateFormatted}`;
      const scoreboardData = await fetchJSON(scoreboardUrl);
      const events = scoreboardData.events || [];

      console.log(`📅 Date ${dateStr}: Found ${events.length} matches in ESPN Scoreboard.`);

      for (const event of events) {
        const eventId = event.id;
        const matchName = event.name || '';
        const comp = event.competitions?.[0] || {};
        const competitors = comp.competitors || [];

        const homeComp = competitors.find((c: any) => c.homeAway === 'home');
        const awayComp = competitors.find((c: any) => c.homeAway === 'away');

        if (!homeComp || !awayComp) continue;

        const homeCode = homeComp.team?.abbreviation;
        const awayCode = awayComp.team?.abbreviation;
        const statusName = event.status?.type?.name || 'STATUS_SCHEDULED';
        const homeScore = homeComp.score !== undefined ? Number(homeComp.score) : 0;
        const awayScore = awayComp.score !== undefined ? Number(awayComp.score) : 0;

        console.log(`  Processing ${homeCode}-${awayCode}...`);

        // Fetch Match Summary from ESPN
        let summaryData: any = {};
        try {
          const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
          summaryData = await fetchJSON(summaryUrl);
        } catch (err) {
          console.error(`  ❌ Failed to fetch match summary for event ${eventId}:`, err);
        }

        // Extract stats
        const teamsStats = summaryData.boxscore?.teams || [];
        const homeStatsList = teamsStats.find((t: any) => t.team?.abbreviation === homeCode)?.statistics || [];
        const awayStatsList = teamsStats.find((t: any) => t.team?.abbreviation === awayCode)?.statistics || [];

        const getStat = (stats: any[], name: string) => {
          const st = stats.find((s: any) => s.name === name);
          return st ? st.displayValue : '0';
        };

        const parsedStats = {
          homePossession: getStat(homeStatsList, 'possessionPct') ? `${getStat(homeStatsList, 'possessionPct')}%` : '50%',
          awayPossession: getStat(awayStatsList, 'possessionPct') ? `${getStat(awayStatsList, 'possessionPct')}%` : '50%',
          homeShots: Number(getStat(homeStatsList, 'totalShots')),
          awayShots: Number(getStat(awayStatsList, 'totalShots')),
          homeShotsOnTarget: Number(getStat(homeStatsList, 'shotsOnTarget')),
          awayShotsOnTarget: Number(getStat(awayStatsList, 'shotsOnTarget')),
          homeCorners: Number(getStat(homeStatsList, 'wonCorners')),
          awayCorners: Number(getStat(awayStatsList, 'wonCorners')),
          homeYellowCards: Number(getStat(homeStatsList, 'yellowCards')),
          awayYellowCards: Number(getStat(awayStatsList, 'yellowCards')),
          homeRedCards: Number(getStat(homeStatsList, 'redCards')),
          awayRedCards: Number(getStat(awayStatsList, 'redCards'))
        };

        const keyEvents = summaryData.keyEvents || [];
        const parsedEvents = keyEvents.map((ev: any) => {
          const clock = ev.clock?.displayValue || (ev.clock?.value ? `${ev.clock.value}'` : '');
          const typeText = ev.type?.text || '';
          const text = ev.text || '';
          return `${clock} [${typeText}] ${text}`;
        }).filter(Boolean);

        const realMatchMeta = {
          id: eventId,
          name: matchName,
          homeTeam: homeCode,
          awayTeam: awayCode,
          homeScore: homeScore,
          awayScore: awayScore,
          status: statusName,
          stadium: comp.venue?.fullName || 'World Cup Stadium',
          time: new Date(event.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          stats: parsedStats,
          events: parsedEvents
        };

        masterDB.espnMatches[dateStr].push(realMatchMeta);
      }
    } catch (err: any) {
      console.error(`❌ Failed scoreboard fetch for ${dateStr}:`, err.message);
    }
  }

  // 5. Fetch Standings from ESPN
  console.log(`🛡️ Fetching real group standings from ESPN...`);
  try {
    const standingsUrl = `https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings`;
    const standingsData = await fetchJSON(standingsUrl);
    
    const parsedStandings: any[] = [];
    const groups = standingsData.children || [];
    
    for (const group of groups) {
      const groupName = group.displayName || '';
      const entries = group.standings?.entries || [];
      const teamsList = entries.map((entry: any) => {
        const stats = entry.stats || [];
        const getVal = (name: string) => {
          const s = stats.find((x: any) => x.name === name);
          return s ? Number(s.value) : 0;
        };

        return {
          code: entry.team?.abbreviation || '',
          name: entry.team?.displayName || '',
          mp: getVal('gamesPlayed'),
          w: getVal('wins'),
          d: getVal('ties'),
          l: getVal('losses'),
          gf: getVal('goalsFor'),
          ga: getVal('goalsAgainst'),
          pts: getVal('points')
        };
      });

      parsedStandings.push({
        group: groupName,
        teams: teamsList
      });
    }

    masterDB.espnStandings = parsedStandings;
    console.log(`✅ Standings loaded successfully for ${parsedStandings.length} groups.`);
  } catch (err: any) {
    console.error(`❌ Failed to fetch standings:`, err.message);
  }

  // Define target directories
  const targetDir = path.resolve('/Users/rajarjan/Documents/game buddy/public/assets/ai');
  const targetFile = path.join(targetDir, 'ai_master.json');

  // Ensure directories exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Save the master JSON
  fs.writeFileSync(targetFile, JSON.stringify(masterDB, null, 2), 'utf-8');
  console.log(`🎉 Master database successfully written to ${targetFile}`);

  // ALSO create a CSV dump directory and write the CSV files there
  const csvDir = path.join(targetDir, 'csv');
  if (!fs.existsSync(csvDir)) {
    fs.mkdirSync(csvDir, { recursive: true });
  }

  fs.writeFileSync(path.join(csvDir, 'teams_ai.csv'), rawTeamsCSV.trim(), 'utf-8');
  fs.writeFileSync(path.join(csvDir, 'matches_ai.csv'), rawMatchesCSV.trim(), 'utf-8');
  fs.writeFileSync(path.join(csvDir, 'days_ai.csv'), rawDaysCSV.trim(), 'utf-8');
  console.log(`🎉 CSV master tables successfully written to ${csvDir}`);
}

runBackfill().catch(err => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});
