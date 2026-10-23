"""Build the website's photo index (site/public/data/photos.json).

Usage:
    python build_index.py [--bibs bibs.csv] [--results results.csv] [--out site/public/data/photos.json]

Lists every photo in the Flickr albums (for the image URL secrets and the time each photo was
taken), joins the race numbers read by read_bibs.py and the official results from
fetch_results.py, and writes one compact JSON file for the front end. Re-run it whenever
read_bibs.py has processed more photos. Photos not processed yet are still included, without bibs.

Each bib read gets a confidence level:
    2  the number is a finisher's and the first name read off the bib matches theirs
    1  the number is a finisher's, but no name was read or it doesn't match
    0  the number isn't any finisher's (a misread, or a runner who didn't finish)
A number with a non-matching name is replaced by a finisher one digit away whose first name
does match, when exactly one such finisher exists (e.g. "145 SARAH" -> 146 when 146 is Sarah),
with confidence 1.
"""

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

from download_album import API_URL, DEFAULT_ALBUMS, HEADERS, get_with_retry, resolve_album

RACE_START = datetime(2026, 10, 18, 9, 0, 0)  # local time, as in results.csv and the camera clocks
# Course order of the albums, matched against the album titles
COURSE_ORDER = ["Start", "Mile 5", "Miles 11 & 19.5", "Mile 24", "Mile 26 (track)",
                "Finish a", "Finish b", "Finish c"]


def album_label(title):
    """'2026  Miles 11 & 19.5' -> 'Miles 11 & 19.5'."""
    return re.sub(r"\s+", " ", re.sub(r"^\s*2026\s+", "", title)).strip()


def list_album(session, url):
    """Return (album_id, title, user_id, photos) for one album, photos as Flickr API dicts."""
    user_id, album_id, api_key = resolve_album(session, url)
    photos, page, pages = [], 1, 1
    while page <= pages:
        data = get_with_retry(session, API_URL, params={
            "method": "flickr.photosets.getPhotos",
            "api_key": api_key,
            "photoset_id": album_id,
            "user_id": user_id,
            "extras": "original_format,date_taken,url_z",
            "per_page": 500,
            "page": page,
            "format": "json",
            "nojsoncallback": 1,
        }).json()
        if data.get("stat") != "ok":
            raise RuntimeError(f"Flickr API error: {data}")
        pages = data["photoset"]["pages"]
        photos += data["photoset"]["photo"]
        page += 1
    title = data["photoset"]["title"]
    print(f"  {album_label(title)}: {len(photos)} photos")
    return album_id, title, user_id, photos


def first_name(name):
    return re.sub(r"[^A-Z]", "", (name or "").split(" ")[0].upper())


def same_name(read, official):
    """The model often truncates or slightly misreads names, so compare the first 4 letters."""
    read = re.sub(r"[^A-Z]", "", read.upper())
    return bool(read) and bool(official) and read[:4] == official[:4]


def one_digit_away(a, b):
    """One digit changed, added or dropped."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = sorted((a, b), key=len)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def score_bibs(bibs, names, finishers):
    """Return [[bib, confidence], ...] for one photo, correcting misread numbers where possible."""
    scored = {}
    for bib, name in zip(bibs, names):
        official = finishers.get(bib)
        if official and same_name(name, official):
            conf = 2
        elif name:
            # The name doesn't match: try a finisher one digit away with this first name
            near = [b for b, n in finishers.items() if one_digit_away(bib, b) and same_name(name, n)]
            if len(near) == 1:
                bib, conf = near[0], 1  # probably right, but common names make it a guess
            else:
                conf = 1 if official else 0
        else:
            conf = 1 if official else 0
        scored[bib] = max(conf, scored.get(bib, 0))
    return [[b, c] for b, c in scored.items()]


def load_bibs(path):
    """photo_id -> (bibs, names) from read_bibs.py's output."""
    found = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            bibs = row["bibs"].split(";") if row["bibs"] else []
            names = row["names"].split(";") if row["names"] else [""] * len(bibs)
            found[row["photo_id"]] = (bibs, names)
    return found


def load_runners(path):
    with open(path, newline="", encoding="utf-8") as f:
        return [{"bib": r["bib"], "name": r["name"], "club": r["club"] or None,
                 "time": r["chip_time"], "pos": int(r["position"])} for r in csv.DictReader(f)]


def seconds_since_start(date_taken):
    return int((datetime.strptime(date_taken, "%Y-%m-%d %H:%M:%S") - RACE_START).total_seconds())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bibs", default="bibs.csv")
    parser.add_argument("--results", default="results.csv")
    parser.add_argument("--out", default="site/public/data/photos.json")
    args = parser.parse_args()

    runners = load_runners(args.results)
    finishers = {r["bib"]: first_name(r["name"]) for r in runners}
    read = load_bibs(args.bibs)

    session = requests.Session()
    session.headers.update(HEADERS)
    print("Listing albums on Flickr")
    albums = [list_album(session, url) for url in DEFAULT_ALBUMS]
    albums.sort(key=lambda a: COURSE_ORDER.index(album_label(a[1])))

    owner = albums[0][2]
    photos = []
    for index, (album_id, title, _, album_photos) in enumerate(albums):
        entries = []
        for p in album_photos:
            if p["originalformat"] != "jpg":
                raise RuntimeError(f"Photo {p['id']} is {p['originalformat']}, the site assumes jpg")
            entry = {
                "id": p["id"], "a": index, "s": p["server"], "k": p["secret"], "ok": p["originalsecret"],
                # The 640px copy is already turned upright, unlike the original's raw pixel size
                "w": p["width_z"], "h": p["height_z"],
                "t": seconds_since_start(p["datetaken"]),
            }
            if p["id"] in read:
                bibs = score_bibs(*read[p["id"]], finishers)
                entry["r"] = 1  # processed by read_bibs.py, even if no bibs were found
                if bibs:
                    entry["b"] = bibs
            entries.append(entry)
        photos += sorted(entries, key=lambda e: (e["t"], e["id"]))

    index = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "owner": owner,
        "albums": [{"id": a[0], "title": a[1].strip(), "label": album_label(a[1])} for a in albums],
        "runners": runners,
        "photos": photos,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(index, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    processed = sum(1 for p in photos if p.get("r"))
    found = {b for p in photos for b, c in p.get("b", []) if c >= 1}
    confident = sum(1 for p in photos for _, c in p.get("b", []) if c == 2)
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB): {len(photos)} photos, {processed} processed, "
          f"{confident} confident bib matches, {len(found)} of {len(runners)} finishers have a photo")


if __name__ == "__main__":
    main()
