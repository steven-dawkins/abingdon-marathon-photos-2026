"""Download the official Abingdon Marathon results from ChronoTrack into results.csv.

Usage:
    python fetch_results.py [--race RACE_ID] [--out results.csv]

Uses the public JSON API behind the ChronoTrack results page
(https://sites.chronotrack.com/event/94541/results), so no account is needed.
Only finishers are listed: the API has no DNF/DNS entries and no split times.
"""

import argparse
import csv
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

EVENT_ID = 94541
DEFAULT_RACE = 251135  # the marathon itself
API_URL = "https://reignite-api.athlinks.com/azp/ctlive/event/{event}/race/{race}/results"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Origin": "https://sites.chronotrack.com",
    "Referer": "https://sites.chronotrack.com/",
}
PAGE_SIZE = 200
LOCAL_TZ = ZoneInfo("Europe/London")
FIELDS = ["bib", "name", "gender", "age", "club", "position", "gender_position",
          "chip_time", "gun_time", "start_time", "finish_time"]


def fetch_all(session, race):
    """Return every finisher's result, in finishing order."""
    url = API_URL.format(event=EVENT_ID, race=race)
    results = []
    while True:
        resp = session.get(url, params={"from": len(results), "limit": PAGE_SIZE}, timeout=30)
        resp.raise_for_status()
        page = [r for interval in resp.json()["intervals"] if interval["full"] for r in interval["results"]]
        results += page
        print(f"  fetched {len(results)}")
        if len(page) < PAGE_SIZE:
            return results


def duration(millis):
    secs = round(millis / 1000)
    return f"{secs // 3600}:{secs // 60 % 60:02d}:{secs % 60:02d}"


def local_time(epoch_millis):
    return datetime.fromtimestamp(epoch_millis / 1000, LOCAL_TZ).strftime("%Y-%m-%d %H:%M:%S")


def club(team):
    # Teams come as "<club>-Male" / "<club>-Female" (the club's scoring team), or null
    return (team or "").removesuffix("-Male").removesuffix("-Female")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--race", type=int, default=DEFAULT_RACE)
    parser.add_argument("--out", default="results.csv")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update(HEADERS)
    results = fetch_all(session, args.race)

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, FIELDS)
        writer.writeheader()
        for r in results:
            if r.get("private"):
                continue  # runners who asked to be hidden from public results
            writer.writerow({
                "bib": r["bib"], "name": r["displayName"], "gender": r["gender"], "age": r["age"],
                "club": club(r.get("team")),
                "position": r["rankings"]["overall"], "gender_position": r["rankings"].get("gender", ""),
                "chip_time": duration(r["chipTimeInMillis"]), "gun_time": duration(r["gunTimeInMillis"]),
                "start_time": local_time(r["startTimeInMillis"]),
                "finish_time": local_time(r["endTimeWithPenaltyInMillis"]),
            })
    print(f"Wrote {args.out} ({len(results)} finishers)")


if __name__ == "__main__":
    main()
