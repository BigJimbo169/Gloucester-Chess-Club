# Gloucester Chess Club Tracker

Scrapes the [ECF rating system](https://rating.englishchess.org.uk) for Gloucester
Chess Club's roster, ratings, and league results, and publishes them as a static
dashboard on GitHub Pages. A scheduled GitHub Action re-runs the scraper and commits
fresh data automatically.

## What's in here

```
scraper/scrape.py       # the scraper (Python, requests + BeautifulSoup)
scraper/requirements.txt
data/roster.json        # club roster + current ratings (seeded with a snapshot)
data/games.json         # league board-by-board results (seeded with a snapshot)
data/meta.json           # last-updated timestamp + which events are tracked
data/fact_table.json     # hand-maintained: player -> team(s) + captaincy (seed/example data)
index.html               # the dashboard — reads roster.json, games.json, meta.json
squad.html                # captain's squad-builder tool — reads fact_table.json, roster.json
.github/workflows/update-data.yml   # scheduled scraper run
```

### `data/fact_table.json`

This one isn't scraped — the ECF's roster and games APIs don't carry team affiliation
or captaincy, so this file is maintained by hand (or however you choose to generate
it) as the source of truth for "who plays for which team, and who captains it":

```json
[
  {
    "ecf_code": "356560K",
    "name": "Steve Martin",
    "teams": [
      { "name": "Gloucester Gargoyles", "role": "captain" },
      { "name": "Gloucester Knightmares", "role": "player" }
    ]
  }
]
```

- `teams` is an array so a player who turns out for more than one team just gets
  more than one entry — no special-casing needed.
- `role` is per team-membership, not per player, so someone can captain one team
  and be a plain player on another. Co-captains work too: just give two different
  players `"role": "captain"` for the same team name.
- The seed data in the repo covers a handful of players as an example of the
  shape — replace it with the full squad list.

The `data/*.json` files are **seeded with a one-off manual pull** (up to 17 Feb 2026
for league results) so the dashboard works the moment you deploy it. Once the GitHub
Action runs, it'll overwrite these with a full, current scrape.

## 1. Set up the repo

1. Create a new GitHub repository and push these files to it (`main` branch).
2. Go to **Settings → Pages**, and under "Build and deployment" choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. Your dashboard will be live at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

## 2. Turn on the scheduled scraper

The workflow in `.github/workflows/update-data.yml` is already set to run every
Monday at 06:00 UTC and commit whatever changed in `data/`. Nothing extra to
configure — Actions are on by default for public repos. To run it immediately
rather than waiting for Monday: go to the **Actions** tab → "Update chess data" →
**Run workflow**.

To change how often it runs, edit the `cron` line — for example `0 6 * * *` for
daily, or `0 6 1,15 * *` for twice a month. ([crontab.guru](https://crontab.guru)
is handy for building these.)

## 3. Track more divisions / seasons

`scraper/scrape.py` has an `EVENTS` list near the top:

```python
EVENTS = [
    ("LN00009272", 1, "North Gloucestershire Division 4"),
]
```

Add a tuple for each additional event you want pulled in. Find an event's code by
browsing [the ECF events list](https://rating.englishchess.org.uk/events/list),
opening the results page for the division/season you want, and copying the
`event_code=` value from its URL. Decrementing the numeric part of an event code
by 1 generally steps to the division above within the same league, if that helps
you find sibling divisions quickly.

## Squad creator (`squad.html`)

A page for captains: pick a team, see who's captain, build a squad by clicking
through the eligible player pool, reorder with the ↑/↓ buttons, then export as
either a copy-pasteable text list or a downloadable team-sheet image (via
[html2canvas](https://html2canvas.hertzen.com/), loaded from a CDN — no install
needed).

Nothing is saved server-side — this is a static site with no backend, so a built
squad only exists in that browser tab until it's exported. That's intentional
rather than a missing feature: exporting is the "save."

If `data/fact_table.json` isn't there or doesn't match the schema above, the page
shows an error explaining the expected shape rather than failing silently.

## Known limitations

- **No official API for league results.** The ECF's public API (documented at
  `rating.englishchess.org.uk/help/api`) covers players, clubs, ratings, and
  individual game history — but not league/event results. `scrape.py` parses the
  HTML results page directly, which means it's more fragile: if the ECF changes
  that page's markup, the parsing logic in `parse_fixture_table()` may need a
  small update. It's written defensively (skips rows it can't parse rather than
  crashing) but hasn't been run against live data by an automated test — check the
  Action's run log after the first live run to confirm it found the expected
  number of games.
- **Per-player full game history isn't scraped.** The ECF blocks automated
  requests to `/players/games?...` (the endpoint listing an individual player's
  full game history) as bot traffic. A GitHub Actions runner has a normal outbound
  IP so this *may* work better there than it did in the environment this was
  built in — worth testing — but it's not wired up in `scrape.py` currently.
  Individual player rating-history pages (`/players?ECF_code=...`, showing
  monthly rating over time) were *not* blocked, so that's a reasonable next
  addition if you want longer-run rating-progression charts per player.
- **Roster field names are best-effort.** `scrape_roster()` reads the ECF's JSON
  club-players API, but this repo was built without direct access to inspect that
  endpoint's raw response — the code guesses at likely field names and falls back
  gracefully, keeping the full raw record in `roster.json` under `"raw"` either
  way. If a field comes through empty after your first live run, check `"raw"`
  for the actual key name and adjust `scrape_roster()` accordingly.

## Local development

```bash
pip install -r scraper/requirements.txt
python scraper/scrape.py          # writes fresh data/*.json
python -m http.server             # serve index.html locally (needed — browsers
                                   # block fetch() against file:// URLs)
```

Then open `http://localhost:8000`.
