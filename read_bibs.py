"""Read runners' race (bib) numbers from the downloaded photos with a local vision model.

Usage:
    python read_bibs.py [photos_dir] [--limit N] [--tiles N] [--max-side PX] [--model NAME]
                        [--max-temp C] [--resume-temp C] [--rest SECONDS]

Needs Ollama running locally with the model pulled (default qwen2.5vl:7b).
Walks every album folder made by download_album.py and appends one row per
photo to bibs.csv, so it can be stopped and re-run: photos already in
bibs.csv are skipped. At the end it writes by_bib.csv, listing every photo
for each race number.

To keep the laptop cool it watches the GPU temperature (via nvidia-smi): above --max-temp
it pauses until the GPU has cooled to --resume-temp. --rest adds a pause after every photo,
which lowers the temperature the whole time at the cost of speed.
"""

import argparse
import base64
import csv
import io
import json
import re
import subprocess
import time
from collections import defaultdict
from pathlib import Path

import requests
from PIL import Image, ImageOps

OLLAMA_URL = "http://localhost:11434/api/chat"
DEFAULT_MODEL = "qwen2.5vl:7b"
FIELDS = ["album", "file", "photo_id", "bibs", "names", "flickr_url", "seconds"]
COOLDOWN_CHECK = 10  # seconds between temperature checks while paused
COOLDOWN_MAX = 15 * 60  # carry on after this long even if it hasn't reached --resume-temp

# Keep the example free of real-looking values: the model copies them into its answer for photos with no bibs
PROMPT = """Read the race number on every runner's bib in this marathon photo.
Each bib shows a large number with the runner's first name below it.
Ignore bibs where the number is mostly hidden.
Answer only with JSON like {"runners": [{"bib": "<number>", "name": "<first name>"}]},
or {"runners": []} if there are no readable bibs."""

def to_base64(im, max_side):
    im = im.copy()
    im.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def views(path, max_side, tiles):
    """The whole photo, plus `tiles` overlapping strips along its long side so small bibs get more pixels.

    Sending one bigger image instead doesn't fit in 8 GB of GPU memory and is ~100x slower.
    """
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")  # many photos are stored sideways
    yield to_base64(im, max_side)
    if tiles < 2:
        return
    w, h = im.size
    long_side = max(w, h)
    size = int(long_side / tiles * 1.3)  # 30% overlap so a bib cut by one strip is whole in the next
    step = (long_side - size) / (tiles - 1)
    for i in range(tiles):
        a = round(i * step)
        box = (a, 0, a + size, h) if w >= h else (0, a, w, a + size)
        yield to_base64(im.crop(box), max_side)


def ask_model(session, image, model):
    resp = session.post(OLLAMA_URL, timeout=600, json={
        "model": model,
        "messages": [{"role": "user", "content": PROMPT, "images": [image]}],
        "stream": False,
        "options": {"temperature": 0, "num_ctx": 4096},
    })
    resp.raise_for_status()
    # Ollama's JSON-schema mode makes this model answer "no runners", so parse its free-text JSON instead
    text = resp.json()["message"]["content"]
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0)).get("runners", []) if match else []


def read_bibs(session, path, model, max_side, tiles):
    found = {}
    for image in views(path, max_side, tiles):
        for r in ask_model(session, image, model):
            bib = re.sub(r"\D", "", str(r.get("bib", ""))).lstrip("0")
            name = str(r.get("name", "")).strip().upper()
            if bib and (bib not in found or not found[bib]):
                found[bib] = name
    # A bib cut off at a strip edge can be misread as a shorter number ("100" for "1008"), so drop a
    # number that is part of a longer one in the same photo unless it has a different runner's name
    return {b: n for b, n in found.items()
            if not any(b != o and b in o and (not n or n == found[o]) for o in found)}


def gpu_temp():
    """GPU temperature in C, or None if nvidia-smi isn't available."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10, check=True).stdout
        return int(out.split()[0])
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def cool_down(max_temp, resume_temp):
    """If the GPU is above max_temp, wait until it's down to resume_temp. Returns seconds paused."""
    temp = gpu_temp()
    if temp is None or temp <= max_temp:
        return 0
    print(f"  GPU at {temp}C (limit {max_temp}C): pausing until it's down to {resume_temp}C", flush=True)
    started = time.time()
    while temp is not None and temp > resume_temp:
        if time.time() - started > COOLDOWN_MAX:
            print(f"  Still {temp}C after {COOLDOWN_MAX // 60} min: carrying on", flush=True)
            break
        time.sleep(COOLDOWN_CHECK)
        temp = gpu_temp()
    paused = time.time() - started
    print(f"  GPU at {temp}C after {paused:.0f}s: resuming", flush=True)
    return paused


def taken_at(path):
    """Time the photo was taken (HH:MM:SS, camera clock) from its EXIF, or "" if it has none."""
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            stamp = exif.get_ifd(0x8769).get(36867) or exif.get(306)  # DateTimeOriginal, else DateTime
        return str(stamp).split(" ")[1] if stamp else ""
    except (OSError, IndexError):
        return ""


def load_photos(photos_dir):
    """Yield manifest rows (plus album folder) for every downloaded photo."""
    for manifest in sorted(photos_dir.glob("*/manifest.csv")):
        with open(manifest, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                path = manifest.parent / row["file"]
                if path.exists():
                    yield path, row


def write_by_bib(results_path, out_path):
    photos = defaultdict(list)
    names = defaultdict(set)
    with open(results_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            bibs = row["bibs"].split(";") if row["bibs"] else []
            row_names = row["names"].split(";") if row["names"] else [""] * len(bibs)
            for bib, name in zip(bibs, row_names):
                photos[bib].append(row)
                if name:
                    names[bib].add(name)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["bib", "names", "photo_count", "album", "file", "flickr_url"])
        for bib in sorted(photos, key=int):
            for row in photos[bib]:
                writer.writerow([bib, "/".join(sorted(names[bib])), len(photos[bib]),
                                 row["album"], row["file"], row["flickr_url"]])
    print(f"Wrote {out_path} ({len(photos)} race numbers)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("photos_dir", nargs="?", default="photos")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-side", type=int, default=1600,
                        help="longest side of each image sent to the model; above ~1600 it no longer fits on an 8 GB GPU")
    parser.add_argument("--tiles", type=int, default=0,
                        help="also send N overlapping close-up strips per photo: finds some smaller bibs, "
                             "but ~5x slower and adds more misreads (try 2)")
    parser.add_argument("--limit", type=int, help="only process this many new photos (for testing)")
    parser.add_argument("--max-temp", type=int, default=75,
                        help="pause when the GPU gets hotter than this (C, default 75)")
    parser.add_argument("--resume-temp", type=int, default=65,
                        help="after pausing, wait until the GPU has cooled to this (C, default 65)")
    parser.add_argument("--rest", type=float, default=0,
                        help="seconds to pause after every photo, to run cooler overall (default 0)")
    parser.add_argument("--out", default="bibs.csv")
    args = parser.parse_args()

    photos_dir = Path(args.photos_dir)
    results_path = Path(args.out)
    done = set()
    if results_path.exists():
        with open(results_path, newline="", encoding="utf-8") as f:
            done = {(r["album"], r["file"]) for r in csv.DictReader(f)}

    todo = [(p, row) for p, row in load_photos(photos_dir) if (row["album"], row["file"]) not in done]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(done)} photos already done, {len(todo)} to process")

    temp = gpu_temp()
    print(f"GPU at {temp}C, pausing above {args.max_temp}C" if temp is not None
          else "Can't read the GPU temperature (nvidia-smi not found): no thermal pauses")

    session = requests.Session()
    new_file = not results_path.exists()
    with open(results_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, FIELDS)
        if new_file:
            writer.writeheader()
        started = time.time()
        for i, (path, row) in enumerate(todo, 1):
            cool_down(args.max_temp, args.resume_temp)
            t0 = time.time()
            try:
                found = read_bibs(session, path, args.model, args.max_side, args.tiles)
            except Exception as e:
                print(f"[{i}/{len(todo)}] {path.name}: error {e} (will retry next run)")
                continue
            secs = time.time() - t0
            writer.writerow({
                "album": row["album"], "file": row["file"], "photo_id": row["photo_id"],
                "bibs": ";".join(found), "names": ";".join(found.values()),
                "flickr_url": row["flickr_url"], "seconds": f"{secs:.1f}",
            })
            f.flush()
            eta = (time.time() - started) / i * (len(todo) - i) / 3600
            summary = ", ".join(f"{b} {n}".strip() for b, n in found.items()) or "none"
            taken = taken_at(path)
            print(f"[{i}/{len(todo)}] {row['album']}/{path.name}{f' @ {taken}' if taken else ''}: "
                  f"{summary} ({secs:.1f}s, ~{eta:.1f}h left)")
            if args.rest:
                time.sleep(args.rest)

    if results_path.exists():
        write_by_bib(results_path, results_path.with_name("by_bib.csv"))


if __name__ == "__main__":
    main()
