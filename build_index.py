"""Build the website's photo index (site/public/data/photos.json).

Usage:
    python build_index.py [--bibs bibs.csv bibs_2pass.csv bibs_llamacpp.csv ...] [--results results.csv] [--out site/public/data/photos.json]

Lists every photo in the Flickr albums (for the image URL secrets and the time each photo was
taken), joins the race numbers read by the bib readers (by default bibs.csv, bibs_2pass.csv and
bibs_llamacpp.csv, where they exist) and the official results from fetch_results.py, and writes one
compact JSON file for the front end. Re-run it whenever more photos have been processed. Photos
not processed yet are still included, without bibs.

Each bib read gets a confidence level:
    3  the number is a finisher's and the first name read off the bib matches theirs, or no name
       could be read (names are often hidden or blurred where the number isn't)
    2  the number is a finisher's, but the name read doesn't match theirs
    1  the number read is part of a finisher's number and the name matches theirs: the bib was
       partly hidden (e.g. "14 SARAH" -> 1425 when 1425 is Sarah)
    0  the number isn't any finisher's (a misread, or a runner who didn't finish)
A number with a non-matching name is replaced by a finisher one digit away whose first name
does match, when exactly one such finisher exists (e.g. "145 SARAH" -> 146 when 146 is Sarah),
with confidence 2. Otherwise every finisher (up to MAX_PARTIAL) whose number contains the
number read, or is one digit away from it, and whose first name matches is added with confidence 1.

It also estimates when each finisher passed each place on the course, by the camera's clock
there (see passing_times), so the site can show photos taken as a runner passed even when their
bib couldn't be read.
"""

import argparse
import csv
import json
import re
import statistics
from bisect import bisect_left, bisect_right
from datetime import datetime, timezone
from pathlib import Path

import requests

from download_album import API_URL, DEFAULT_ALBUMS, HEADERS, get_with_retry, resolve_album
from read_bibs import drop_counting

RACE_START = datetime(2026, 10, 18, 9, 0, 0)  # local time, as in results.csv and the camera clocks
MAX_PARTIAL = 4  # more finishers than this matching a partial number and name is too vague to list
# Course order of the albums, matched against the album titles
COURSE_ORDER = ["Start", "Mile 5", "Miles 11 & 19.5", "Mile 24", "Mile 26 (track)",
                "Finish a", "Finish b", "Finish c"]
DEFAULT_BIBS = ["bibs.csv", "bibs_2pass.csv", "bibs_llamacpp.csv"]

MARATHON_MILES = 26.2188
# Places photographed, as (album label, place label, miles from the start). One album covers two
# places: the course passes that spot twice
COURSE_POINTS = [("Start", "Start", 0), ("Mile 5", "Mile 5", 5),
                 ("Miles 11 & 19.5", "Mile 11", 11), ("Miles 11 & 19.5", "Mile 19.5", 19.5),
                 ("Mile 24", "Mile 24", 24), ("Mile 26 (track)", "Mile 26 (track)", 26),
                 ("Finish a", "Finish a", MARATHON_MILES), ("Finish b", "Finish b", MARATHON_MILES),
                 ("Finish c", "Finish c", MARATHON_MILES)]
MIN_MATCHES = 20  # runners matched at a place before its camera clock is trusted
NEIGHBOURS = 15  # matched runners with the nearest finish times used to correct each estimate
NEIGHBOUR_RANGE = 30 * 60  # ...as long as they finished within this many seconds of the runner
MIN_NEIGHBOURS = 5


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
    """The model often truncates or slightly misreads names, so compare the first 4 letters, or
    as many as both have when one is shorter ("ABI" for ABIGAIL, "ED" for EDWARD)."""
    read = re.sub(r"[^A-Z]", "", read.upper())
    n = min(4, len(read), len(official or ""))
    return n >= 2 and read[:n] == official[:n]


def one_digit_away(a, b):
    """One digit changed, added or dropped."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = sorted((a, b), key=len)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def score_bibs(bibs, names, finishers):
    """Return ([[bib, confidence], ...], {bibs whose name matched}) for one photo, correcting
    misread numbers where possible."""
    scored, named = {}, set()

    def add(bib, conf):
        scored[bib] = max(conf, scored.get(bib, 0))

    for bib, name in zip(bibs, names):
        official = finishers.get(bib)
        if official and same_name(name, official):
            add(bib, 3)
            named.add(bib)
            continue
        # The reader sometimes repeats the number where it couldn't read a name
        name = re.sub(r"[^A-Z]", "", name.upper())
        if official and not name:
            add(bib, 3)
            continue
        if name:
            # The name doesn't match: try a finisher one digit away with this first name
            near = [b for b, n in finishers.items() if one_digit_away(bib, b) and same_name(name, n)]
            if len(near) == 1:
                add(near[0], 2)  # probably right, but common names make it a guess
                continue
            # Or a partly hidden bib: finishers whose number contains the digits read. Several
            # finishers one digit away are weaker candidates too
            partial = {b for b, n in finishers.items() if bib in b and b != bib and same_name(name, n)}
            partial.update(near)
            if len(partial) <= MAX_PARTIAL:
                for b in partial:
                    add(b, 1)
        add(bib, 2 if official else 0)
    return [[b, c] for b, c in scored.items()], named


def load_bibs(paths):
    """photo_id -> (bibs, names) from the bib readers' output files, combining
    the readings of a photo that is in more than one file."""
    found = {}
    for path in paths:
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["seconds"] is None:
                    continue  # the last row, still being written by a reader that's running
                bibs = row["bibs"].split(";") if row["bibs"] else []
                names = row["names"].split(";") if row["names"] else [""] * len(bibs)
                # Also cleans up rows read before read_bibs.py had this filter
                pairs = drop_counting(list(zip(bibs, names)))
                old_bibs, old_names = found.get(row["photo_id"], ([], []))
                found[row["photo_id"]] = (old_bibs + [b for b, _ in pairs], old_names + [n for _, n in pairs])
    return found


def age_group(age):
    """Age group for the stats: ages themselves aren't published."""
    if age < 35:
        return "Under 35"
    if age >= 70:
        return "70+"
    return f"{age // 5 * 5}–{age // 5 * 5 + 4}"


def club_name(club):
    """Entries typed in lower case, or with stray spaces, would otherwise split a club in two."""
    club = re.sub(r"\s+", " ", club).strip()
    return club.title() if club.islower() else club


def load_runners(path):
    with open(path, newline="", encoding="utf-8") as f:
        return [{"bib": r["bib"], "name": r["name"], "club": club_name(r["club"]) or None,
                 "time": r["chip_time"], "pos": int(r["position"]), "g": r["gender"],
                 "ag": age_group(int(r["age"]))} for r in csv.DictReader(f)]


def seconds_since_start(date_taken):
    return int((datetime.strptime(date_taken, "%Y-%m-%d %H:%M:%S") - RACE_START).total_seconds())


def load_chip_times(path):
    """bib -> (start, finish) as seconds since the race start, from the official results."""
    with open(path, newline="", encoding="utf-8") as f:
        return {r["bib"]: (seconds_since_start(r["start_time"]), seconds_since_start(r["finish_time"]))
                for r in csv.DictReader(f)}


def passing_times(photos, named, album_labels, chip_times):
    """Estimate when each finisher passed each place on the course, by the camera's clock there.

    An even pace between the runner's chip start and finish times gives a first guess. Runners
    matched by number and name at a place (named: photo id -> bibs) show how far out that guess is there,
    which covers both the camera's clock being off and how runners really pace themselves. So each
    runner's guess is corrected by the median error of the NEIGHBOURS matched runners with the
    nearest finish times. Places with fewer than MIN_MATCHES matched runners get no estimates.

    Returns (points, {bib: [seconds or None for each point]}). Each point has the half-width of the
    window around an estimate that held 90% of the matched runners when each was left out in turn.
    """
    points = [(a, label, miles / MARATHON_MILES) for a, album in enumerate(album_labels)
              for point_album, label, miles in COURSE_POINTS if point_album == album]
    # Times each matched runner was photographed at each place
    seen = {}
    for p in photos:
        for bib in named.get(p["id"], ()):
            if bib not in chip_times:
                continue
            start, finish = chip_times[bib]
            # Where an album covers two places, the one nearer an even pace is the one they were at
            here = [i for i, (a, _, _) in enumerate(points) if a == p["a"]]
            point = min(here, key=lambda i: abs((p["t"] - start) / (finish - start) - points[i][2]))
            seen.setdefault((point, bib), []).append(p["t"])

    def guess(bib, point):
        start, finish = chip_times[bib]
        return start + points[point][2] * (finish - start)

    album_times = {}
    for p in photos:
        album_times.setdefault(p["a"], []).append(p["t"])
    for times in album_times.values():
        times.sort()

    results, estimates = [], {bib: [] for bib in chip_times}
    for point, (a, label, _) in enumerate(points):
        # (finish time, error of the even-pace guess, bib), one per runner, sorted by finish time
        matches = sorted((chip_times[bib][1], statistics.median(ts) - guess(bib, point), bib)
                         for (pt, bib), ts in seen.items() if pt == point)
        if len(matches) < MIN_MATCHES:
            continue
        finishes = [m[0] for m in matches]

        def correction(finish, leave_out=None):
            lo = bisect_left(finishes, finish - NEIGHBOUR_RANGE)
            hi = bisect_right(finishes, finish + NEIGHBOUR_RANGE)
            near = sorted((m for m in matches[lo:hi] if m[2] != leave_out), key=lambda m: abs(m[0] - finish))
            near = near[:NEIGHBOURS]
            return statistics.median(m[1] for m in near) if len(near) >= MIN_NEIGHBOURS else None

        misses = sorted(abs(error - c) for finish, error, bib in matches
                        if (c := correction(finish, leave_out=bib)) is not None)
        window = max(2, round(misses[int(0.9 * (len(misses) - 1))]))
        results.append({"a": a, "label": label, "w": window})

        times = album_times[a]
        for bib, (_, finish) in chip_times.items():
            c = correction(finish)
            t = None if c is None else round(guess(bib, point) + c)
            # Only where the photographer was there then
            if t is not None and bisect_right(times, t + window) == bisect_left(times, t - window):
                t = None
            estimates[bib].append(t)
        print(f"  {label}: {len(matches)} runners matched, 90% within +/-{window} s of their estimate, "
              f"{sum(1 for e in estimates.values() if e[-1] is not None)} runners estimated")
    return results, estimates


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bibs", nargs="+", help=f"default: {' and '.join(DEFAULT_BIBS)}, where they exist")
    parser.add_argument("--results", default="results.csv")
    parser.add_argument("--out", default="site/public/data/photos.json")
    args = parser.parse_args()

    runners = load_runners(args.results)
    finishers = {r["bib"]: first_name(r["name"]) for r in runners}
    read = load_bibs(args.bibs or [p for p in DEFAULT_BIBS if Path(p).exists()])

    session = requests.Session()
    session.headers.update(HEADERS)
    print("Listing albums on Flickr")
    albums = [list_album(session, url) for url in DEFAULT_ALBUMS]
    albums.sort(key=lambda a: COURSE_ORDER.index(album_label(a[1])))

    owner = albums[0][2]
    photos, named = [], {}
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
                bibs, named[p["id"]] = score_bibs(*read[p["id"]], finishers)
                entry["r"] = 1  # processed by read_bibs.py, even if no bibs were found
                if bibs:
                    entry["b"] = bibs
            entries.append(entry)
        photos += sorted(entries, key=lambda e: (e["t"], e["id"]))

    print("Estimating when each runner passed each place")
    points, estimates = passing_times(photos, named, [album_label(a[1]) for a in albums], load_chip_times(args.results))
    for runner in runners:
        if any(t is not None for t in estimates[runner["bib"]]):
            runner["e"] = estimates[runner["bib"]]

    index = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "owner": owner,
        "albums": [{"id": a[0], "title": a[1].strip(), "label": album_label(a[1])} for a in albums],
        "points": points,
        "runners": runners,
        "photos": photos,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(index, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    processed = sum(1 for p in photos if p.get("r"))
    found = {b for p in photos for b, c in p.get("b", []) if c >= 2}
    confident = sum(1 for p in photos for _, c in p.get("b", []) if c == 3)
    partial = sum(1 for p in photos for _, c in p.get("b", []) if c == 1)
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB): {len(photos)} photos, {processed} processed, "
          f"{confident} confident bib matches, {partial} partial-number matches, "
          f"{len(found)} of {len(runners)} finishers have a photo")


if __name__ == "__main__":
    main()
