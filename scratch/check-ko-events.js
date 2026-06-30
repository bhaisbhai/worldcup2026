async function main() {
  try {
    const url = 'https://www.game-buddy.co.uk/api/scoreboard?dates=20260628-20260719&limit=100';
    const r = await fetch(url);
    const data = await r.json();
    console.log('Events length:', data.events?.length);
    if (data.events) {
      data.events.forEach((e, idx) => {
        console.log(`${idx + 1}. Match ${e.id}: ${e.name}`);
        e.competitions?.[0]?.competitors?.forEach(c => {
          console.log(`  - ${c.homeAway}: ${c.team?.displayName} (${c.team?.abbreviation})`);
        });
      });
    }
  } catch (e) {
    console.error('Error:', e);
  }
}
main();
