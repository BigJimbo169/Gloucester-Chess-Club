#!/usr/bin/env python3
"""
Gloucester Chess Club data scraper.

Pulls:
  - the club roster + current ratings, via the ECF's public JSON API
  - board-by-board league results for one or more events, by scraping the
    ECF's HTML results pages (there is no public API for this data)

Writes data/roster.json, data/games.json and data/meta.json.

Usage:
    python scrape.py

Configure CLUB_CODE and EVENTS below. Add more entries to EVENTS to track
more divisions/seasons -- find their event_code by browsing
https://rating.englishchess.org.uk/events/list and opening the event you want;
the code is the `event_code=` query parameter on its results page.
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://rating.englishchess.org.uk"

# ---- Configuration -------------------------------------------------------

CLUB_CODE = "4GLO"  # Gloucester

# Each entry: (event_code, section_no, friendly label).
# section_no appears to be ignored by the site for single-section events,
# but is kept here in case a future event has more than one section.
EVENTS = [
    ("LN00009272", 1, "North Gloucestershire Division 4"),
]

OUT_DIR = Path(__file__).resolve().parent.parent / "data"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; GloucesterChessTracker/1.0; "
        "run for a local chess club, contact via GitHub repo)"
    )
}

# ---- Helpers ---------------------------------------------------------------

SCORE_RE = re.compile(r"^(1-0|0-1|1/2-1/2|½-½)$")
RATING_RE = re.compile(r"^(\d{2,4})([A-Za-z])$")
PLAYER_NO_RE = re.compile(r"player_no=(\w+)")
DATE_RE = re.compile(r"^\d{1,2} [A-Za-z]{3} \d{4}$")


def fetch(url, **params):
    r = requests.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r


def normalize_date(text):
    try:
        return datetime.strptime(text.strip(), "%d %b %Y").date().isoformat()
    except ValueError:
        return None


# ---- Roster -----------------------------------------------------------------

def scrape_roster(club_code):
    """Pull the club roster + current ratings from the public JSON API."""
    r = fetch(f"{BASE}/api/clubs/players", code=club_code)
    data = r.json()
    # The API wraps results; be defensive about the exact shape.
    players = data.get("players", data) if isinstance(data, dict) else data
    out = []
    for p in players:
        out.append({
            "ecf_code": p.get("ECF_code") or p.get("player_code") or p.get("code"),
            "member_no": p.get("membership_no") or p.get("member_no"),
            "first_name": p.get("first_name") or p.get("forename"),
            "last_name": p.get("surname") or p.get("last_name"),
            "club": p.get("club_name") or p.get("club"),
            "std_rating": p.get("std_rating") or p.get("standard"),
            "rapid_rating": p.get("rapid_rating") or p.get("rapid"),
            "blitz_rating": p.get("blitz_rating") or p.get("blitz"),
            "raw": p,  # keep the raw record too -- field names vary by API version
        })
    return out


# ---- League results ---------------------------------------------------------

def parse_fixture_table(table, home, away):
    games = []
    for tr in table.find_all("tr"):
        player_links = [a for a in tr.find_all("a") if PLAYER_NO_RE.search(a.get("href", ""))]
        if len(player_links) < 2:
            continue  # header row or malformed row
        p1_a, p2_a = player_links[0], player_links[1]
        p1_no = PLAYER_NO_RE.search(p1_a["href"]).group(1)
        p2_no = PLAYER_NO_RE.search(p2_a["href"]).group(1)

        cell_texts = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        date_text = next((t for t in cell_texts if DATE_RE.match(t)), None)
        board = cell_texts[0].rstrip(".") if cell_texts and cell_texts[0].rstrip(".").isdigit() else None
        score = next((t for t in cell_texts if SCORE_RE.match(t.replace(" ", ""))), None)

        # Ratings are usually rendered as links to /robo_audit?... with text like "1502K"
        rating_links = [a.get_text(strip=True) for a in tr.find_all("a") if RATING_RE.match(a.get_text(strip=True))]
        p1_rating = rating_links[0] if len(rating_links) > 0 else None
        p2_rating = rating_links[1] if len(rating_links) > 1 else None

        games.append({
            "date": normalize_date(date_text) if date_text else None,
            "home": home,
            "away": away,
            "board": board,
            "p1_name": p1_a.get_text(strip=True),
            "p1_no": p1_no,
            "p1_rating": p1_rating,
            "p2_name": p2_a.get_text(strip=True),
            "p2_no": p2_no,
            "p2_rating": p2_rating,
            "result": score,
        })
    return games


def scrape_event_games(event_code, section_no, label):
    r = fetch(f"{BASE}/events/list-games-event", event_code=event_code, section_no=section_no)
    soup = BeautifulSoup(r.text, "html.parser")

    games = []
    # Each fixture is a heading "Home v Away" followed by its results table.
    for heading in soup.find_all(re.compile("^h[1-6]$")):
        title = heading.get_text(strip=True)
        if " v " not in title:
            continue
        home, away = [s.strip() for s in title.split(" v ", 1)]
        table = heading.find_next("table")
        if table is None:
            continue
        fixture_games = parse_fixture_table(table, home, away)
        for g in fixture_games:
            g["event_code"] = event_code
            g["event_label"] = label
        games.extend(fixture_games)

    return games


# ---- Main --------------------------------------------------------------------

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Scraping roster for club {CLUB_CODE} ...")
    try:
        roster = scrape_roster(CLUB_CODE)
        print(f"  {len(roster)} players")
    except Exception as e:
        print(f"  FAILED: {e}", file=sys.stderr)
        roster = []

    all_games = []
    for event_code, section_no, label in EVENTS:
        print(f"Scraping {label} ({event_code}) ...")
        try:
            games = scrape_event_games(event_code, section_no, label)
            print(f"  {len(games)} boards")
            all_games.extend(games)
        except Exception as e:
            print(f"  FAILED: {e}", file=sys.stderr)
        time.sleep(1)  # be polite between requests

    (OUT_DIR / "roster.json").write_text(json.dumps(roster, indent=2, ensure_ascii=False))
    (OUT_DIR / "games.json").write_text(json.dumps(all_games, indent=2, ensure_ascii=False))
    (OUT_DIR / "meta.json").write_text(json.dumps({
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "club_code": CLUB_CODE,
        "events": [{"event_code": c, "label": l} for c, _, l in EVENTS],
        "roster_count": len(roster),
        "games_count": len(all_games),
    }, indent=2))

    print(f"\nWrote {len(roster)} players and {len(all_games)} boards to {OUT_DIR}")


if __name__ == "__main__":
    main()
