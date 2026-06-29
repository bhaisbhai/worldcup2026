# FIFA World Cup 2026 Dashboard

A live, single-page dashboard for the 2026 FIFA World Cup. Free-to-air, no sign-in, no subscription.

**Live at:** https://worldcup2026.vercel.app

---

## Features

- **Live scores** — real-time match clock and scoreline via ESPN's public API, auto-refreshing every 30 seconds
- **Upcoming fixtures** — kick-off time (local), venue, and UK TV channel for every match
- **Finished results** — scoreline, goalscorers, and BBC highlight clips where available
- **UK TV channel guide** — every match labelled BBC One / BBC Two / ITV1 / ITV4 (or blank if unconfirmed)
- **Match detail modal** — tabs for Overview (odds, pre-match countdown), Stats, Lineups, Highlights, and News
- **Group table** — live standings across all groups
- **Knockout bracket** — Round of 32 onward
- **Day navigation** — browse any date of the tournament
- **Push notifications** — opt-in daily fixture and recap alerts (via web push / service worker)
- **Team pages** — squad, form, and tournament stats per nation

---

## Tech stack

| Layer | Detail |
|---|---|
| Hosting | Vercel (static + serverless) |
| Scores & fixtures | [ESPN public API](https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard) |
| Highlights | BBC Sport YouTube uploads playlist (no API key required) |
| Push notifications | Web Push (VAPID) via `/api/subscribe` and `/api/push` |
| Match recaps | `/api/recaps.js` — serverless, cached in `data/` |
| Styles | Vanilla CSS (dark theme, CSS variables) |
| No build step | Plain HTML/JS/CSS — `index.html` is the entire app |

---

## UK TV channel data

All 104 matches are broadcast free-to-air on BBC and ITV. Channel assignments are stored in the `UK_TV` object in `index.html` as sorted team-abbreviation pairs:

```js
const UK_TV = {
  'COD|ENG': 'BBC One',   // England v DR Congo — Round of 32
  'BEL|SEN': 'ITV1',      // Belgium v Senegal  — Round of 32
  // ...
};
function getUKChannel(a1, a2) {
  return UK_TV[[a1, a2].sort().join('|')] || '';
}
```

Team abbreviations match ESPN's `team.abbreviation` field (e.g. `ENG`, `FRA`, `BRA`, `COD`).

### Broadcast schedule by round

#### Group stage (June 11–27)
Full schedule embedded in `UK_TV` — 52 confirmed matches across BBC One, BBC Two, ITV1, and ITV4.

#### Round of 32 (June 29–July 4)
| Date | Match | Channel |
|---|---|---|
| Mon 29 Jun | Brazil v Japan | ITV1 |
| Mon 29 Jun | Germany v Paraguay | BBC One |
| Tue 30 Jun | Netherlands v Morocco | ITV1 |
| Tue 30 Jun | Ivory Coast v Norway | BBC One |
| Tue 30 Jun | France v Sweden | ITV1 |
| Wed 1 Jul | Mexico v Ecuador | ITV1 |
| Wed 1 Jul | England v DR Congo | BBC One |
| Wed 1 Jul | Belgium v Senegal | ITV1 |
| Thu 2 Jul | USA v Bosnia-Herzegovina | BBC One |
| Thu 3 Jul | Spain v Austria | BBC One |
| Fri 4 Jul | Portugal v Croatia | BBC One |
| Fri 4 Jul | Switzerland v Algeria | BBC One |
| Fri 4 Jul | Australia v Egypt | BBC One |
| Fri 4 Jul | Argentina v Cape Verde | ITV1 |
| Sat 5 Jul | Colombia v Ghana | ITV1 |

#### Round of 16 and beyond
Channel assignments are added automatically after each round completes via a scheduled Claude Code agent (see [Automated updates](#automated-updates) below). Source: [live-footballontv.com](https://www.live-footballontv.com/live-world-cup-football-on-tv.html).

---

## Automated updates

A scheduled agent runs after the last game of each knockout round and:

1. Fetches the latest UK TV listings from live-footballontv.com / sportsmole.co.uk
2. Adds the new round's channel assignments to `UK_TV` in `index.html`
3. Updates this README with the new broadcast schedule table
4. Commits and pushes to `main` — Vercel deploys automatically

**Next scheduled run:** July 5, 2026 at 08:00 BST (after Round of 32 concludes)

---

## Local development

No build step needed. Open `index.html` directly in a browser, or serve with any static server:

```bash
python3 -m http.server 7890
# then open http://localhost:7890
```

For the API routes (push notifications, recaps) you need the Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

---

## API routes

| Route | Description |
|---|---|
| `GET /api/scoreboard` | Proxies ESPN scoreboard (avoids CORS) |
| `GET /api/summary?event=<id>` | Proxies ESPN match summary |
| `GET /api/statistics?event=<id>` | Proxies ESPN match stats |
| `POST /api/subscribe` | Saves a Web Push subscription |
| `POST /api/push` | Sends a push notification (internal) |
| `GET /api/recaps` | Returns daily match recap blurbs |

---

## Changelog

### July 2026
- **R32 TV channels** — added all 15 Round of 32 UK broadcast assignments
- **Removed countdown timer** — "Tomorrow" / "Xh Xm" label removed from upcoming match cards (noise)
- **Channel fallback** — unknown-channel games now show nothing instead of misleading "BBC/ITV" placeholder

### June 2026
- Initial tournament launch with full group stage TV listings
- Live scores, highlights, push notifications, group tables, knockout bracket
