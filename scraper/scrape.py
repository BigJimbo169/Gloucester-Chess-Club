#!/usr/bin/env python3
"""
Gloucester Chess Club data scraper (v2).

Reads data/fact_table.json -- the hand-maintained source of truth for which
players exist, which team(s) they're on, and captaincy -- and for every
listed ECF code pulls:

  - current Standard/Rapid/Blitz ratings
  - full monthly rating history (all domains)
  - game-by-game history, best-effort (see "Known limitations" in the README:
    this endpoint has blocked every manual test so far)

Writes:
  data/players.json          fact table rows + current ratings, merged
  data/rating_history.json   one row per player/domain/month
  data/games.json            one row per player/domain/game (may be sparse
                              or empty -- see README)
  data/meta.json              run timestamp, counts, and any warnings

Run: python scrape.py
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
REPO_ROOT = Path(__file__).resolve().parent.parent
FACT_TABLE_PATH = REPO_ROOT / "data" / "fact_table.json"
OUT_DIR = REPO_ROOT / "data"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; GloucesterChessTracker/1.0; "
        "run for a local chess club -- see repo README)"
    )
}

DOMAINS = {"S": "Standard", "R": "Rapid", "B": "Blitz"}
MONTH_RE = re.compile(r"^([A-Za-z]{3,9})\s+(\d{4})$")


def fetch(url, **params):
    r = requests.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r


def player_no(ecf_code):
    m = re.match(r"(\d+)", ecf_code or "")
    return m.group(1) if m else None


def normalize_month(text):
    """'Sep 2026' / 'September 2026' -> '2026-09-01'; None if it doesn't parse."""
    text = text.strip()
    if not MONTH_RE.match(text):
        return None
    for fmt in ("%b %Y", "%B %Y"):
        try:
            return datetime.strptime(text, fmt).date().replace(day=1).isoformat()
        except ValueError:
            continue
    return None


# ---- Ratings: current + monthly history --------------------------------------

def scrape_profile(ecf_code):
    """
    Scrapes the player's public profile page (confirmed reachable in manual
    testing, unlike the games endpoint below) for current ratings and full
    monthly rating history.

    NOTE: the heading/table structure this looks for ("Standard" / "Rapid" /
    "Blitz" headings each followed by a month/rating table) matches what this
    page rendered in manual testing, but hasn't been machine-verified against
    raw HTML. If a run comes back with zero history for players who
    definitely have some, inspect one profile page's HTML and adjust the
    selectors below.
    """
    r = fetch(f"{BASE}/players", ECF_code=ecf_code)
    soup = BeautifulSoup(r.text, "html.parser")

    current = {}
    history = []

    for heading in soup.find_all(re.compile("^h[1-6]$")):
        label = heading.get_text(strip=True)
        domain = next((full for full in DOMAINS.values() if full.lower() in label.lower()), None)
        if not domain:
            continue
        table = heading.find_next("table")
        if table is None:
            continue
        rows = []
        for tr in table.find_all("tr"):
            cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            month = normalize_month(cells[0])
            rating_match = re.match(r"^(\d{2,4})", cells[1])
            if month and rating_match:
                rows.append((month, int(rating_match.group(1))))
        if rows:
            rows.sort()  # oldest first
            history.extend({"ecf_code": ecf_code, "domain": domain, "month": m, "rating": v} for m, v in rows)
            current[domain] = rows[-1][1]  # most recent published figure

    return current, history


# ---- Game history (best effort, unverified) -----------------------------------

RESULT_MAP = {"1": "W", "0": "L", "5": "D"}

def parse_opponent_name(raw):
    """API returns 'Surname, Forename' -- flip it for display."""
    if not raw or "," not in raw:
        return raw
    surname, forename = [s.strip() for s in raw.split(",", 1)]
    return f"{forename} {surname}"

def scrape_games(ecf_code):
    pno = player_no(ecf_code)
    if not pno:
        return [], "no numeric player_no could be parsed from ECF code"

    games, error = [], None
    for code, domain in DOMAINS.items():
        try:
            r = fetch(f"{BASE}/api/games", player_no=pno, domain=code, limit=100)
            payload = r.json()
            entries = payload.get("data", {}).get("games", [])
            for g in entries:
                games.append({
                    "ecf_code": ecf_code,
                    "domain": domain,
                    "date": g.get("game_date"),
                    "colour": g.get("colour"),
                    "result": RESULT_MAP.get(str(g.get("score")), "?"),
                    "opponent_name": parse_opponent_name(g.get("opponent_name")),
                    "opponent_no": g.get("opponent_no"),
                    "opponent_rating": int(g["opponent_rating"]) if g.get("opponent_rating") not in (None, "") else None,
                    "player_rating": int(g["player_rating"]) if g.get("player_rating") not in (None, "") else None,
                    "player_rating_suffix": g.get("increment"),
                    "event_code": g.get("event_code"),
                    "event_name": g.get("event_name"),
                    "raw": g,
                })
        except Exception as e:
            error = str(e)
        time.sleep(0.3)
    return games, error


# ---- Main ------------------------------------------------------------------------

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fact_table = json.loads(FACT_TABLE_PATH.read_text())

    players_out, rating_history, games, warnings = [], [], [], []

    for p in fact_table:
        code = p["ecf_code"]
        label = f"{p.get('first_name','')} {p.get('surname','')} ({code})"
        print(f"Scraping {label} ...")

        try:
            current, history = scrape_profile(code)
        except Exception as e:
            print(f"  profile FAILED: {e}", file=sys.stderr)
            warnings.append(f"{code}: profile scrape failed ({e})")
            current, history = {}, []
        rating_history.extend(history)

        player_games, err = scrape_games(code)
        if not player_games:
            warnings.append(f"{code}: no games returned" + (f" ({err})" if err else " (endpoint likely blocked -- see README)"))
        games.extend(player_games)

        players_out.append({
            **p,
            "std_rating": current.get("Standard"),
            "rapid_rating": current.get("Rapid"),
            "blitz_rating": current.get("Blitz"),
        })
        time.sleep(0.5)

    (OUT_DIR / "players.json").write_text(json.dumps(players_out, indent=2, ensure_ascii=False))
    (OUT_DIR / "rating_history.json").write_text(json.dumps(rating_history, indent=2, ensure_ascii=False))
    (OUT_DIR / "games.json").write_text(json.dumps(games, indent=2, ensure_ascii=False))
    (OUT_DIR / "meta.json").write_text(json.dumps({
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "player_count": len(players_out),
        "rating_history_rows": len(rating_history),
        "games_rows": len(games),
        "warnings": warnings,
    }, indent=2))

    print(f"\nWrote {len(players_out)} players, {len(rating_history)} rating-history rows, {len(games)} games.")
    if warnings:
        print(f"{len(warnings)} warnings logged -- see data/meta.json")


if __name__ == "__main__":
    main()
