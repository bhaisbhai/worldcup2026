import { createIcons, Trophy, Calendar, Swords, Users, Clock, AlertTriangle, MessageSquareCode, Award, ArrowRight, Shield, X, MapPin } from 'lucide';

// Define the global state on window
declare global {
  interface Window {
    aiData: any;
  }
}

// Static Metadata for Tournament Teams (Names & Flags only)
const TEAMS_METADATA: Record<string, { name: string; flag: string; group: string }> = {
  ENG: { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", group: "Group A" },
  SEN: { name: "Senegal", flag: "🇸🇳", group: "Group A" },
  ARG: { name: "Argentina", flag: "🇦🇷", group: "Group B" },
  POL: { name: "Poland", flag: "🇵🇱", group: "Group B" },
  SCO: { name: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", group: "Group C" },
  MAR: { name: "Morocco", flag: "🇲🇦", group: "Group C" },
  BRA: { name: "Brazil", flag: "🇧🇷", group: "Group C" },
  HAI: { name: "Haiti", flag: "🇭🇹", group: "Group C" },
  USA: { name: "United States", flag: "🇺🇸", group: "Group D" },
  AUS: { name: "Australia", flag: "🇦🇺", group: "Group D" },
  PAR: { name: "Paraguay", flag: "🇵🇾", group: "Group D" },
  TUR: { name: "Turkey", flag: "🇹🇷", group: "Group D" },
  GER: { name: "Germany", flag: "🇩🇪", group: "Group E" },
  CIV: { name: "Ivory Coast", flag: "🇨🇮", group: "Group E" },
  ECU: { name: "Ecuador", flag: "🇪🇨", group: "Group E" },
  CUR: { name: "Curaçao", flag: "🇨🇼", group: "Group E" },
  NED: { name: "Netherlands", flag: "🇳🇱", group: "Group F" },
  SWE: { name: "Sweden", flag: "🇸🇪", group: "Group F" },
  TUN: { name: "Tunisia", flag: "🇹🇳", group: "Group F" },
  JPN: { name: "Japan", flag: "🇯🇵", group: "Group F" },
  BIH: { name: "Bosnia & Herzegovina", flag: "🇧🇦", group: "Group E" },
  ESP: { name: "Spain", flag: "🇪🇸", group: "Group C" },
  KSA: { name: "Saudi Arabia", flag: "🇸🇦", group: "Group C" },
  BEL: { name: "Belgium", flag: "🇧🇪", group: "Group D" },
  IRN: { name: "Iran", flag: "🇮🇷", group: "Group D" },
  URU: { name: "Uruguay", flag: "🇺🇺", group: "Group D" },
  CPV: { name: "Cape Verde", flag: "🇨🇻", group: "Group D" },
  NZL: { name: "New Zealand", flag: "🇳🇿", group: "Group C" },
  EGY: { name: "Egypt", flag: "🇪🇬", group: "Group C" }
};

// Helper to escape HTML to prevent XSS
function escapeHTML(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Find ESPN match metadata dynamically by key (e.g. "NED-SWE")
function findESPNMatch(matchKey: string): any {
  if (!window.aiData || !window.aiData.espnMatches) return null;
  for (const date of Object.keys(window.aiData.espnMatches)) {
    const list = window.aiData.espnMatches[date] || [];
    const found = list.find((m: any) => `${m.homeTeam}-${m.awayTeam}` === matchKey);
    if (found) {
      return { ...found, date };
    }
  }
  return null;
}

// 4. Initialize Database
async function initAIDatabase() {
  console.log("📂 Ingesting Master AI Database...");
  try {
    const res = await fetch("/assets/ai/ai_master.json");
    window.aiData = await res.json();
    console.log("✅ Loaded master database:", window.aiData);
  } catch (error) {
    console.error("❌ Failed to load Master AI DB. Falling back to empty state.", error);
    window.aiData = { matches: {}, teams: {}, days: {}, today_preview: {}, espnMatches: {}, espnStandings: [] };
  }
}

// 5. Briefing Card State Machine
function renderPunditBriefing() {
  const briefingBadge = document.getElementById("briefing-badge");
  const briefingDate = document.getElementById("briefing-date");
  const briefingContent = document.getElementById("briefing-main-content");
  if (!briefingBadge || !briefingDate || !briefingContent) return;

  const previewData = window.aiData.today_preview || {};
  const daysData = window.aiData.days || {};

  const userCurrentTime = new Date();
  const firstKickoffTime = new Date(previewData.firstKickoffTime || "2026-06-20T18:00:00Z");

  // Determine state
  const isPreKickoff = userCurrentTime < firstKickoffTime;

  if (isPreKickoff) {
    // PRE-KICKOFF STATE: Render Preview
    briefingBadge.innerHTML = `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono tracking-wide animate-pulse">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> PREVIEW MODE
      </span>
    `;
    briefingDate.textContent = `Today: ${new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}`;

    briefingContent.innerHTML = `
      <h3 class="text-2xl font-bold tracking-tight text-white font-sans">${escapeHTML(previewData.headline || "A Heavyweight Slate Awaits")}</h3>
      <div class="space-y-3 mt-4 text-gray-300 border-l-2 border-amber-500/30 pl-4">
        <p class="text-sm"><strong class="font-mono text-xs uppercase text-amber-500 tracking-wider">The Big Ones:</strong> ${escapeHTML(previewData.theBigOnes || "Germany faces Ivory Coast; Netherlands takes on Sweden.")}</p>
        <p class="text-sm"><strong class="font-mono text-xs uppercase text-amber-500 tracking-wider">Players to Watch:</strong> ${escapeHTML(previewData.playersToWatch || "Look out for Jamal Musiala's direct runs.")}</p>
      </div>
      <div class="mt-4 pt-3 border-t border-gray-800 flex items-center gap-2 text-xs font-mono text-gray-500">
        <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-500"></i>
        <span>Kickoff Countdown: first match starts at ${firstKickoffTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} UTC</span>
      </div>
    `;
  } else {
    // POST-KICKOFF STATE: Render Recap of completed day
    const availableDates = Object.keys(daysData).sort();
    const targetDate = availableDates[availableDates.length - 1] || "2026-06-20";
    const recap = daysData[targetDate] || {
      headline: "The Pundits Are Speechless",
      theDrama: "An absolute circus on the pitch today. Tactical blueprints thrown straight out the window.",
      mustWatchHighlights: "Watch all games; they defy belief. Even the boring ones had errors worth mocking.",
      progressionNews: "No official updates yet; the table is in pure gridlock."
    };

    briefingBadge.innerHTML = `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono tracking-wide">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> PUNDIT RECAP
      </span>
    `;
    briefingDate.textContent = `Recap: ${targetDate}`;

    briefingContent.innerHTML = `
      <h3 class="text-2xl font-bold tracking-tight text-white font-sans">${escapeHTML(recap.headline)}</h3>
      <div class="space-y-3 mt-4 text-gray-300 border-l-2 border-emerald-500/30 pl-4">
        <p class="text-sm"><strong class="font-mono text-xs uppercase text-emerald-500 tracking-wider">The Drama:</strong> ${escapeHTML(recap.theDrama)}</p>
        <p class="text-sm"><strong class="font-mono text-xs uppercase text-emerald-500 tracking-wider">Highlights Verdict:</strong> ${escapeHTML(recap.mustWatchHighlights)}</p>
        <p class="text-sm"><strong class="font-mono text-xs uppercase text-emerald-500 tracking-wider">Tournament News:</strong> ${escapeHTML(recap.progressionNews)}</p>
      </div>
    `;
  }
  createIcons({ icons: { Clock } });
}

// 6. Render Scoreboard (on Today tab)
function renderTodayScoreboard() {
  const container = document.getElementById("today-scoreboard");
  if (!container) return;

  // Determine latest date with matches in ESPN payload
  const dates = Object.keys(window.aiData.espnMatches || {}).sort();
  const targetDate = dates[dates.length - 1] || "2026-06-20";

  const matches = window.aiData.espnMatches?.[targetDate] || [];

  if (matches.length === 0) {
    container.innerHTML = `<div class="text-gray-500 font-mono text-xs p-4 border border-dashed border-gray-800 rounded-xl text-center">No matches scheduled or played for ${targetDate}.</div>`;
    return;
  }

  container.innerHTML = matches.map((match: any) => {
    const key = `${match.homeTeam}-${match.awayTeam}`;
    const homeTeam = TEAMS_METADATA[match.homeTeam] || { name: match.homeTeam, flag: "🏳️", group: "Unknown" };
    const awayTeam = TEAMS_METADATA[match.awayTeam] || { name: match.awayTeam, flag: "🏳️", group: "Unknown" };
    
    // Check if AI analysis exists
    const aiAnalysis = window.aiData.matches && window.aiData.matches[key];
    const hasBriefing = !!aiAnalysis;

    return `
      <div class="glass-panel hover:border-gray-700/80 rounded-xl p-4 flex flex-col justify-between transition-all duration-200 cursor-pointer" onclick="openMatchModal('${key}')">
        <div class="flex items-center justify-between">
          <span class="font-mono text-xs text-gray-500 flex items-center gap-1">
            <i data-lucide="map-pin" class="w-3 h-3 text-gray-600"></i> ${escapeHTML(match.stadium)}
          </span>
          ${hasBriefing ? `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <i data-lucide="message-square-code" class="w-2.5 h-2.5"></i> PUNDIT COMMENTARY
            </span>
          ` : `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-gray-500 border border-gray-800/40">
              ${escapeHTML(match.status)}
            </span>
          `}
        </div>
        
        <!-- Score Layout -->
        <div class="flex items-center justify-between py-4">
          <!-- Home -->
          <div class="flex items-center space-x-3 w-2/5">
            <span class="text-3xl">${homeTeam.flag}</span>
            <div class="flex flex-col">
              <span class="font-bold text-white tracking-wide text-sm sm:text-base">${homeTeam.name}</span>
              <span class="font-mono text-[10px] text-gray-500 uppercase">${homeTeam.group}</span>
            </div>
          </div>
          
          <!-- Score -->
          <div class="flex items-center space-x-2 font-mono text-xl font-bold bg-gray-950/80 border border-gray-800 px-3 py-1 rounded-lg">
            <span class="${match.homeScore > match.awayScore ? 'text-amber-500' : 'text-white'}">${match.homeScore}</span>
            <span class="text-gray-600">-</span>
            <span class="${match.awayScore > match.homeScore ? 'text-amber-500' : 'text-white'}">${match.awayScore}</span>
          </div>
          
          <!-- Away -->
          <div class="flex items-center space-x-3 w-2/5 justify-end text-right">
            <div class="flex flex-col">
              <span class="font-bold text-white tracking-wide text-sm sm:text-base">${awayTeam.name}</span>
              <span class="font-mono text-[10px] text-gray-500 uppercase">${awayTeam.group}</span>
            </div>
            <span class="text-3xl">${awayTeam.flag}</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between pt-2 border-t border-gray-900/60 text-xs font-mono text-gray-500">
          <span>Kickoff: ${match.time} Local</span>
          <span class="text-amber-500 flex items-center gap-1 hover:underline">
            View Stats & Pundit's Take <i data-lucide="arrow-right" class="w-3 h-3"></i>
          </span>
        </div>
      </div>
    `;
  }).join('');

  createIcons({ icons: { MapPin, ArrowRight, MessageSquareCode } });
}

// 7. Render Standings (on Today tab)
function renderTodayStandings() {
  const container = document.getElementById("today-standings");
  if (!container) return;

  const standings = window.aiData.espnStandings || [];

  if (standings.length === 0) {
    container.innerHTML = `<div class="text-gray-500 font-mono text-xs">Standings data not loaded yet.</div>`;
    return;
  }

  // Render first 4 groups as summary, or filter them
  container.innerHTML = standings.slice(0, 4).map((group: any) => {
    return `
      <div class="space-y-2">
        <h3 class="font-mono text-xs font-bold text-gray-400 border-b border-gray-800 pb-1">${escapeHTML(group.group)}</h3>
        <table class="w-full text-left font-mono text-[11px] text-gray-400">
          <thead>
            <tr class="text-gray-600 font-bold border-b border-gray-950">
              <th class="py-1">Team</th>
              <th class="py-1 text-center">MP</th>
              <th class="py-1 text-center">GD</th>
              <th class="py-1 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            ${group.teams.map((t: any) => {
              const meta = TEAMS_METADATA[t.code] || { name: t.name, flag: "🏳️" };
              const gd = t.gf - t.ga;
              const gdSign = gd > 0 ? `+${gd}` : gd;
              return `
                <tr class="border-b border-gray-900/40 hover:bg-gray-800/10">
                  <td class="py-1 flex items-center space-x-1.5 font-sans font-medium text-white">
                    <span>${meta.flag}</span>
                    <span class="cursor-pointer hover:underline text-xs" onclick="openTeamModal('${t.code}')">${t.code}</span>
                  </td>
                  <td class="py-1 text-center">${t.mp}</td>
                  <td class="py-1 text-center ${gd > 0 ? 'text-emerald-500' : gd < 0 ? 'text-red-400' : 'text-gray-500'}">${gdSign}</td>
                  <td class="py-1 text-right font-bold text-white">${t.pts}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }).join('<div class="h-4"></div>');
}

// 8. Render Fixtures Tab
function renderFixturesTab() {
  const container = document.getElementById("matches-list");
  if (!container) return;

  const matchesByDate = window.aiData.espnMatches || {};
  const sortedDates = Object.keys(matchesByDate).sort();

  if (sortedDates.length === 0) {
    container.innerHTML = `<div class="text-gray-500 font-mono text-xs p-4 text-center">No fixtures available.</div>`;
    return;
  }

  container.innerHTML = sortedDates.map(date => {
    const matches = matchesByDate[date] || [];
    const dateFormatted = new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    
    return `
      <div class="space-y-3">
        <h3 class="font-mono text-xs uppercase tracking-widest text-amber-500 border-b border-gray-800 pb-1.5 pl-1 font-bold">${dateFormatted}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${matches.map((match: any) => {
            const key = `${match.homeTeam}-${match.awayTeam}`;
            const home = TEAMS_METADATA[match.homeTeam] || { name: match.homeTeam, flag: "🏳️" };
            const away = TEAMS_METADATA[match.awayTeam] || { name: match.awayTeam, flag: "🏳️" };
            const aiAnalysis = window.aiData.matches && window.aiData.matches[key];
            const hasBriefing = !!aiAnalysis;

            return `
              <div class="glass-panel hover:border-gray-700/80 rounded-xl p-4 flex items-center justify-between cursor-pointer transition-all duration-200" onclick="openMatchModal('${key}')">
                <div class="flex-1 flex items-center justify-between">
                  <!-- Home -->
                  <div class="flex items-center space-x-2 w-[42%]">
                    <span class="text-2xl">${home.flag}</span>
                    <span class="font-sans font-bold text-white text-sm truncate">${home.name}</span>
                  </div>
                  
                  <!-- Score Box -->
                  <div class="flex items-center justify-center font-mono font-bold text-xs bg-gray-950 border border-gray-800 px-2.5 py-1 rounded w-16 text-center">
                    <span class="text-white">${match.homeScore}</span>
                    <span class="text-gray-600 px-1">-</span>
                    <span class="text-white">${match.awayScore}</span>
                  </div>
                  
                  <!-- Away -->
                  <div class="flex items-center space-x-2 w-[42%] justify-end text-right">
                    <span class="font-sans font-bold text-white text-sm truncate">${away.name}</span>
                    <span class="text-2xl">${away.flag}</span>
                  </div>
                </div>
                
                <!-- Comment badge -->
                ${hasBriefing ? `
                  <div class="ml-3 pl-3 border-l border-gray-800 text-amber-500 hover:text-amber-400">
                    <i data-lucide="message-square-code" class="w-4 h-4"></i>
                  </div>
                ` : `
                  <div class="ml-3 pl-3 border-l border-gray-800/20 text-gray-700">
                    <i data-lucide="swords" class="w-4 h-4"></i>
                  </div>
                `}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  createIcons({ icons: { MessageSquareCode, Swords } });
}

// 9. Render Teams Grid Tab
function renderTeamsTab() {
  const container = document.getElementById("teams-grid");
  if (!container) return;

  container.innerHTML = Object.entries(TEAMS_METADATA).map(([code, team]) => {
    const aiAnalysis = window.aiData.teams && window.aiData.teams[code];
    const hasPundit = !!aiAnalysis;

    return `
      <div class="glass-panel hover:border-gray-700/80 rounded-xl p-4 flex flex-col items-center justify-between text-center cursor-pointer transition-all duration-200" onclick="openTeamModal('${code}')">
        <span class="text-4xl py-2">${team.flag}</span>
        <div class="flex flex-col">
          <span class="font-sans font-bold text-white text-sm tracking-wide">${team.name}</span>
          <span class="font-mono text-[10px] text-gray-500 uppercase mt-0.5">${team.group}</span>
        </div>
        
        <div class="mt-4 pt-2 w-full border-t border-gray-900/60 flex items-center justify-center">
          ${hasPundit ? `
            <span class="text-[10px] font-mono text-emerald-500 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
              PUNDIT REPORT
            </span>
          ` : `
            <span class="text-[10px] font-mono text-gray-500 border border-gray-800/40 px-2 py-0.5 rounded">
              PROFILE
            </span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// 10. Open Match Modal
(window as any).openMatchModal = function(key: string) {
  const modal = document.getElementById("match-modal");
  const content = document.getElementById("match-modal-content");
  if (!modal || !content) return;

  const match = findESPNMatch(key);
  if (!match) return;

  const home = TEAMS_METADATA[match.homeTeam] || { name: match.homeTeam, flag: "🏳️", group: "Unknown" };
  const away = TEAMS_METADATA[match.awayTeam] || { name: match.awayTeam, flag: "🏳️", group: "Unknown" };
  const aiAnalysis = window.aiData.matches && window.aiData.matches[key];

  let punditTakeHTML = `
    <div class="border border-dashed border-gray-800 rounded-xl p-5 bg-gray-950/30 text-center font-mono text-xs text-gray-500 flex flex-col items-center justify-center space-y-2">
      <i data-lucide="alert-triangle" class="w-5 h-5 text-gray-600"></i>
      <span>Pundit commentary has not been synchronized for this match yet. Check back overnight.</span>
    </div>
  `;

  if (aiAnalysis) {
    punditTakeHTML = `
      <div class="border-2 border-amber-500/25 bg-amber-500/[0.02] rounded-xl p-5 space-y-4">
        <!-- Badge + Title -->
        <div class="flex flex-col space-y-1">
          <span class="font-mono text-[10px] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-1.5">
            <i data-lucide="message-square-code" class="w-3.5 h-3.5"></i> The Pundit's Verdict
          </span>
          <h4 class="text-lg font-bold font-mono text-white tracking-tight uppercase">${escapeHTML(aiAnalysis.editionTitle)}</h4>
        </div>
        
        <p class="text-sm leading-relaxed text-gray-300 italic font-sans border-l-2 border-amber-500 pl-3">
          "${escapeHTML(aiAnalysis.snappySummary)}"
        </p>
        
        <!-- Talking points -->
        <div class="space-y-2 pt-2">
          <h5 class="font-mono text-xs font-bold text-gray-400">Tactical Talking Points:</h5>
          <ul class="space-y-1 text-xs text-gray-300 list-disc list-inside font-sans pl-1">
            ${aiAnalysis.talkingPoints.map((pt: string) => `<li>${escapeHTML(pt)}</li>`).join('')}
          </ul>
        </div>
        
        <!-- Random Quirk -->
        <div class="bg-gray-950/60 rounded-lg p-3 border border-gray-900 flex items-start gap-2.5">
          <i data-lucide="award" class="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0"></i>
          <div class="space-y-0.5">
            <span class="font-mono text-[10px] uppercase font-bold text-gray-500">Quirky Match Highlight</span>
            <p class="text-xs text-gray-300 leading-relaxed font-sans">${escapeHTML(aiAnalysis.randomQuirk)}</p>
          </div>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <!-- Header/Teams -->
    <div class="flex items-center justify-between bg-gray-950/50 border border-gray-800 rounded-xl p-5">
      <div class="flex items-center space-x-3 w-[40%]">
        <span class="text-4xl">${home.flag}</span>
        <div class="flex flex-col">
          <span class="font-bold text-white tracking-wide">${home.name}</span>
          <span class="font-mono text-[10px] text-gray-500">${home.group}</span>
        </div>
      </div>
      
      <div class="font-mono text-2xl font-bold bg-gray-950 border border-gray-800 px-4 py-1.5 rounded-xl">
        <span class="text-white">${match.homeScore}</span>
        <span class="text-gray-600 px-1">-</span>
        <span class="text-white">${match.awayScore}</span>
      </div>
      
      <div class="flex items-center space-x-3 w-[40%] justify-end text-right">
        <div class="flex flex-col">
          <span class="font-bold text-white tracking-wide">${away.name}</span>
          <span class="font-mono text-[10px] text-gray-500">${away.group}</span>
        </div>
        <span class="text-4xl">${away.flag}</span>
      </div>
    </div>

    <!-- Match Stats -->
    <div class="grid grid-cols-2 gap-4">
      <!-- General Stats -->
      <div class="glass-panel border border-gray-800/80 rounded-xl p-4 space-y-3">
        <h4 class="font-mono text-xs uppercase font-bold text-gray-400 border-b border-gray-800/40 pb-1.5 flex items-center gap-1.5">
          <i data-lucide="list-ordered" class="w-3.5 h-3.5 text-gray-500"></i> Match Stats
        </h4>
        
        <div class="space-y-2 text-xs font-mono">
          <!-- Possession -->
          <div class="grid grid-cols-3 text-center items-center">
            <span class="text-white text-left">${match.stats?.homePossession || '50%'}</span>
            <span class="text-gray-500 text-xs font-semibold">Possession</span>
            <span class="text-white text-right">${match.stats?.awayPossession || '50%'}</span>
          </div>
          <!-- Shots -->
          <div class="grid grid-cols-3 text-center items-center">
            <span class="text-white text-left">${match.stats?.homeShots || 0}</span>
            <span class="text-gray-500 text-xs font-semibold">Total Shots</span>
            <span class="text-white text-right">${match.stats?.awayShots || 0}</span>
          </div>
          <!-- Shots on Target -->
          <div class="grid grid-cols-3 text-center items-center">
            <span class="text-white text-left">${match.stats?.homeShotsOnTarget || 0}</span>
            <span class="text-gray-500 text-xs font-semibold">On Target</span>
            <span class="text-white text-right">${match.stats?.awayShotsOnTarget || 0}</span>
          </div>
          <!-- Corners -->
          <div class="grid grid-cols-3 text-center items-center">
            <span class="text-white text-left">${match.stats?.homeCorners || 0}</span>
            <span class="text-gray-500 text-xs font-semibold">Corners</span>
            <span class="text-white text-right">${match.stats?.awayCorners || 0}</span>
          </div>
          <!-- Cards -->
          <div class="grid grid-cols-3 text-center items-center">
            <span class="text-white text-left">${match.stats?.homeYellowCards || 0} Y / ${match.stats?.homeRedCards || 0} R</span>
            <span class="text-gray-500 text-xs font-semibold">Cards</span>
            <span class="text-white text-right">${match.stats?.awayYellowCards || 0} Y / ${match.stats?.awayRedCards || 0} R</span>
          </div>
        </div>
      </div>
      
      <!-- Match Timeline -->
      <div class="glass-panel border border-gray-800/80 rounded-xl p-4 space-y-3">
        <h4 class="font-mono text-xs uppercase font-bold text-gray-400 border-b border-gray-800/40 pb-1.5 flex items-center gap-1.5">
          <i data-lucide="clock" class="w-3.5 h-3.5 text-gray-500"></i> Match Timeline
        </h4>
        <div class="space-y-2 max-h-[120px] overflow-y-auto pr-1">
          ${!match.events || match.events.length === 0 ? `
            <span class="text-xs font-mono text-gray-600">No events recorded.</span>
          ` : match.events.map((ev: string) => {
            const isGoal = ev.toLowerCase().includes('goal');
            const isRed = ev.toLowerCase().includes('red');
            return `
              <div class="flex items-start space-x-2 text-xs font-sans text-gray-300">
                <span class="font-mono text-[10px] font-semibold ${isGoal ? 'text-amber-500' : isRed ? 'text-red-500' : 'text-gray-500'}">
                  ${ev.split(' ')[0]}
                </span>
                <span class="text-gray-300 leading-tight">${ev.split(' ').slice(1).join(' ')}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Pundit Take -->
    ${punditTakeHTML}
  `;

  modal.classList.remove("hidden");
  createIcons({ icons: { MessageSquareCode, Award, AlertTriangle } });
};

// 11. Open Team Modal
(window as any).openTeamModal = function(code: string) {
  const modal = document.getElementById("team-modal");
  const content = document.getElementById("team-modal-content");
  if (!modal || !content) return;

  const team = TEAMS_METADATA[code];
  if (!team) return;

  const aiAnalysis = window.aiData.teams && window.aiData.teams[code];

  let punditTakeHTML = `
    <div class="border border-dashed border-gray-800 rounded-xl p-5 bg-gray-950/30 text-center font-mono text-xs text-gray-500 flex flex-col items-center justify-center space-y-2">
      <i data-lucide="alert-triangle" class="w-5 h-5 text-gray-600"></i>
      <span>AI pundit commentary is not synchronized for this team yet. Check back overnight.</span>
    </div>
  `;

  if (aiAnalysis) {
    punditTakeHTML = `
      <div class="space-y-4">
        <!-- Headline -->
        <div class="border-b border-gray-800 pb-3">
          <span class="font-mono text-[9px] font-bold uppercase tracking-widest text-emerald-500 flex items-center gap-1">
            <i data-lucide="message-square-code" class="w-3.5 h-3.5"></i> Pundit Headline
          </span>
          <h4 class="text-base font-bold font-mono text-white uppercase mt-1 leading-snug">"${escapeHTML(aiAnalysis.headline)}"</h4>
        </div>
        
        <!-- Story So Far -->
        <div class="space-y-1">
          <span class="font-mono text-[9px] uppercase text-gray-500 font-bold">Story So Far</span>
          <p class="text-xs leading-relaxed text-gray-300 font-sans pl-1">
            ${escapeHTML(aiAnalysis.storySoFar)}
          </p>
        </div>
        
        <!-- What's Next -->
        <div class="space-y-1 pt-1">
          <span class="font-mono text-[9px] uppercase text-gray-500 font-bold">Pundit's Prescription</span>
          <p class="text-xs leading-relaxed text-amber-400 font-sans pl-1">
            ${escapeHTML(aiAnalysis.whatsNext)}
          </p>
        </div>
        
        <!-- Pub Ammo -->
        <div class="bg-gray-950/80 rounded-lg p-3.5 border border-gray-900 flex items-start gap-2.5 mt-2">
          <i data-lucide="award" class="w-4.5 h-4.5 text-emerald-500 mt-0.5 flex-shrink-0"></i>
          <div class="space-y-0.5">
            <span class="font-mono text-[9px] uppercase font-bold text-gray-500">Pub Ammo Trivia</span>
            <p class="text-xs text-gray-300 leading-relaxed font-sans">${escapeHTML(aiAnalysis.pubAmmo)}</p>
          </div>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div class="flex items-center space-x-4 bg-gray-950/40 border border-gray-800 rounded-xl p-5">
      <span class="text-5xl">${team.flag}</span>
      <div class="flex flex-col">
        <h3 class="text-xl font-bold text-white tracking-wide">${team.name}</h3>
        <span class="font-mono text-xs text-gray-500 uppercase mt-0.5">${team.group}</span>
      </div>
    </div>
    
    ${punditTakeHTML}
  `;

  modal.classList.remove("hidden");
  createIcons({ icons: { MessageSquareCode, Award, AlertTriangle } });
};

// 12. Main Application Mounting
document.addEventListener("DOMContentLoaded", async () => {
  // Mount initial Lucide icons
  createIcons({ icons: { Trophy, Calendar, Swords, Users, Clock, Shield, X } });

  // Load Database
  await initAIDatabase();

  // Render Initial View
  renderPunditBriefing();
  renderTodayScoreboard();
  renderTodayStandings();
  renderFixturesTab();
  renderTeamsTab();

  // Interactive Tabs
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");
      
      // Update buttons style
      tabButtons.forEach(b => {
        b.classList.remove("text-white", "bg-gray-800");
        b.classList.add("text-gray-400");
      });
      btn.classList.remove("text-gray-400");
      btn.classList.add("text-white", "bg-gray-800");

      // Hide all contents and show selected
      tabContents.forEach(content => {
        content.classList.add("hidden");
      });
      const selectedContent = document.getElementById(`content-${tabName}`);
      if (selectedContent) {
        selectedContent.classList.remove("hidden");
      }
    });
  });

  // Modal Closures
  document.getElementById("close-match-modal")?.addEventListener("click", () => {
    document.getElementById("match-modal")?.classList.add("hidden");
  });
  document.getElementById("close-team-modal")?.addEventListener("click", () => {
    document.getElementById("team-modal")?.classList.add("hidden");
  });

  // Click outside to close modals
  window.addEventListener("click", (e) => {
    const matchModal = document.getElementById("match-modal");
    const teamModal = document.getElementById("team-modal");
    if (e.target === matchModal) {
      matchModal?.classList.add("hidden");
    }
    if (e.target === teamModal) {
      teamModal?.classList.add("hidden");
    }
  });
});
