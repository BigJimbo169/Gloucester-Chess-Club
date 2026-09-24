# Gloucester Chess Club Tracker

A hand-maintained roster (`data/fact_table.json`) drives a scraper that pulls
current ratings, rating history, and (best-effort) game history from the
[ECF rating system](https://rating.englishchess.org.uk), and a static
dashboard on GitHub Pages presents it: a rating-progression view with
hoverable match detail, and a drag-and-drop squad builder for captains.

## What's in here

```
data/fact_table.json      # hand-maintained: ecf_code, name, nickname, team(s) + captaincy
data/players.json         # generated: fact_table.json + current ratings, merged
data/rating_history.json  # generated: one row per player/domain/month
data/games.json           # generated: one row per player/domain/game (best-effort, may be sparse)
data/meta.json            # generated: last-run timestamp, counts, warnings
scraper/scrape.py         # the scraper (Python, requests + BeautifulSoup)
scraper/requirements.txt
index.html                # the dashboard — two tabs, reads the four generated files above
.github/workflows/update-data.yml   # scheduled scraper run
```

## `data/fact_table.json` — the one file you maintain by hand

The ECF's ratings data has no concept of your club's own teams or who
captains them, so this file is the source of truth for that. Everything else
is derived from it plus the ECF site.

```json
[
  {
    "ecf_code": "356560K",
    "first_name": "Steve",
    "surname": "Martin",
    "nickname": "Marto",
    "teams": [
      { "team_name": "Gladiators", "role": "captain" },
      { "team_name": "Dragons", "role": "player" }
    ]
  }
]
```

- `nickname` is optional — omit the key entirely for players without one,
  rather than setting it to `""`.
- `teams` is an array: a player on more than one team just gets more than one
  entry. `role` is per team-membership, so someone can captain one team and
  be a plain player on another, and two players can both hold
  `"role": "captain"` on the same team for co-captains.
- Names are written out by hand here rather than pulled from the API, since
  it's simpler to type once than to rely on an unverified name field from a
  third-party endpoint (see limitations below).

## 1. Set up the repo

1. Push these files to a new GitHub repository (`main` branch).
2. **Settings → Pages** → Deploy from a branch → `main` / `(root)` → Save.
3. Dashboard is live at `https://<you>.github.io/<repo>/` shortly after.

## 2. Turn on the scheduled scraper

`.github/workflows/update-data.yml` runs `scraper/scrape.py` every Monday at
06:00 UTC and commits whatever changed under `data/`. To run it immediately:
**Actions** tab → "Update chess data" → **Run workflow**. Change the `cron`
line to adjust frequency.

## The dashboard

**Rating progression tab** — filter by team, individual player, time control
(Standard/Rapid/Blitz), and season (`25/26`-style labels, running
September–August, derived automatically from the data — no need to maintain
these anywhere). Selecting a team with no individual player chosen plots
every eligible player as a separate line, for comparison. Hovering a point
shows the club's published rating for that month plus any games on record
for that player/domain/month — since the ECF publishes a **monthly** rating
rather than updating live per game, a hover point can represent more than
one game, not exactly one.

**Squad builder tab** — pick a team to see its captain(s) banner and its
eligible player pool. Click a player to add them to the squad; drag by the
⠿ handle to set board order; ✕ to remove. Sum and average rating (using
`std_rating`, falling back to `rapid_rating` then `blitz_rating` if a player
has no standard-play figure) update live at the bottom of the squad list, and
are included in both exports. Names throughout this tab render as
`Firstname "Nickname" Surname` where a nickname exists. Nothing is saved
anywhere — this is a static site with no backend — so exporting (copy as
text, or download as an image via
[html2canvas](https://html2canvas.hertzen.com/), loaded from a CDN) is the
only way a built squad survives past that browser tab.

## Known limitations

- **The game history endpoint is unverified.** `/api/games` is documented to
  exist but has blocked every manual request made against it while building
  this — it may behave differently from a GitHub Actions runner's IP, but
  until proven otherwise, expect `data/games.json` to come back sparse or
  empty, and hover tooltips in the progression chart to show a rating with
  no game list beneath it. The seed data ships with this file empty for that
  reason. `scrape_games()` keeps each raw API record under `"raw"` so field
  names (currently guessed: `opponent_name`, `result`, `event_name`, etc.)
  are easy to correct once a real response is seen.
- **Rating-history page structure is a best-effort match**, not a
  machine-verified one. `scrape_profile()` looks for "Standard" / "Rapid" /
  "Blitz" headings each followed by a month/rating table, matching what
  manual testing showed — if a run comes back with unexpectedly empty
  history for players who should have plenty, check one player's profile
  page HTML directly and adjust the selectors in `scrape_profile()`.
- **League/team results scraping has been removed** from this version
  (previously pulled from the ECF's HTML results pages) — that's being
  reworked separately. `games.json` in this version is a flat per-player
  list with no notion of which team a game was played for; if/when
  team-level results come back, expect a join against a small fixtures table
  (date + team + opponent) rather than a field baked into the games data
  itself, since the underlying per-player game record likely has no team
  concept at all.
- **Squad totals use whichever primary rating a player has** — standard,
  falling back to rapid then blitz — rather than requiring a specific time
  control. A squad with a mix of players who only have, say, a rapid rating
  will silently blend rapid and standard figures into one sum/average. Worth
  keeping in mind for squads spanning very different player pools; not
  currently flagged in the UI beyond the "N player(s) have no rating on
  file" note for players with none at all.

## Local development

```bash
pip install -r scraper/requirements.txt
python scraper/scrape.py     # writes fresh data/*.json from fact_table.json
python -m http.server        # serve locally -- browsers block fetch() on file://
```

Then open `http://localhost:8000`.
