#!/usr/bin/env node
// Updates data/player-clubs.json club field from the CSV.
// Matches by normalized name (lowercase, accent-stripped).

const fs = require('fs');
const path = require('path');

const CSV_PATH = process.argv[2] || '/root/.claude/uploads/f32a2fbf-f56b-5d7a-b113-f4a1652153f0/e1c3cd75-wc26_players_on_fire.csv';
const CLUBS_PATH = path.join(__dirname, '../data/player-clubs.json');

function normalize(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse CSV (handles quoted fields with commas)
function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple CSV parse — handle quoted fields
    const cols = [];
    let cur = '', inQ = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') { inQ = !inQ; }
      else if (line[c] === ',' && !inQ) { cols.push(cur); cur = ''; }
      else { cur += line[c]; }
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

// Map CSV position codes to ESPN single-letter codes
function mapPosition(p) {
  if (!p) return '';
  const u = p.toUpperCase();
  if (u === 'GK') return 'G';
  if (u === 'DF') return 'D';
  if (u === 'MF') return 'M';
  if (u === 'FW') return 'F';
  return '';
}

const csvText = fs.readFileSync(CSV_PATH, 'utf8');
const csvRows = parseCSV(csvText);
console.log(`CSV rows: ${csvRows.length}`);

// Build name → CSV row map (normalized)
const csvByName = {};
csvRows.forEach(row => {
  const key = normalize(row.player_name);
  if (key) csvByName[key] = row;
});

const clubs = JSON.parse(fs.readFileSync(CLUBS_PATH, 'utf8'));
const entries = Object.entries(clubs);

let matched = 0, updated = 0, unmatched = [];

entries.forEach(([id, entry]) => {
  const key = normalize(entry.name);
  const csv = csvByName[key];
  if (!csv) {
    unmatched.push(entry.name);
    return;
  }
  matched++;
  const newClub = csv.club || '';
  const oldClub = entry.club || '';
  const newPos  = mapPosition(csv.position) || entry.position || '';
  const newJersey = csv.shirt_number || entry.jersey || '';

  if (newClub !== oldClub || newPos !== entry.position || newJersey !== entry.jersey) {
    if (newClub !== oldClub) {
      console.log(`  CLUB UPDATE: ${entry.name} [${id}]: "${oldClub}" → "${newClub}"`);
    }
    entry.club    = newClub;
    entry.position = newPos;
    entry.jersey   = newJersey;
    updated++;
  }
});

console.log(`\nMatched: ${matched}/${entries.length}, Updated: ${updated}`);
console.log(`Unmatched ESPN entries (${unmatched.length}):`, unmatched.slice(0, 30));

fs.writeFileSync(CLUBS_PATH, JSON.stringify(clubs, null, 2));
console.log('\nWrote', CLUBS_PATH);
