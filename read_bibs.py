"""Read runners' race (bib) numbers from the downloaded photos with a local vision model.

Usage:
    python read_bibs.py [photos_dir] [--limit N] [--tiles N] [--max-side PX] [--url URL] [--model NAME]
                        [--max-temp C] [--resume-temp C] [--rest SECONDS]

Needs a vision model behind an OpenAI-compatible chat endpoint: llama.cpp's llama-server
(default --url, see the README) or Ollama (--url http://localhost:11434/v1/chat/completions).
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

DEFAULT_URL = "http://localhost:8080/v1/chat/completions"  # llama-server
DEFAULT_MODEL = "qwen2.5vl:7b"  # Ollama's name for it; llama-server answers with whichever model it loaded
FIELDS = ["album", "file", "photo_id", "bibs", "names", "flickr_url", "seconds"]
COOLDOWN_CHECK = 10  # seconds between temperature checks while paused
COOLDOWN_MAX = 15 * 60  # carry on after this long even if it hasn't reached --resume-temp
# Plenty for ~25 runners. The model sometimes gets stuck counting ("1000 DANIEL, 1001 DANIEL, ...")
# until it fills its context, so this stops it early (and saves ~80s per such photo)
MAX_ANSWER_TOKENS = 400
MIN_RUN = 3  # this many numbers in a row going up or down in equal steps, all one name, are the model counting

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


def ask_model(session, url, image, model, prompt=PROMPT):
    # The context size is set when the server starts (llama-server -c 8192), not per request
    resp = session.post(url, timeout=600, json={
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image}"}},
        ]}],
        "stream": False,
        "temperature": 0,
        "max_tokens": MAX_ANSWER_TOKENS,
    })
    resp.raise_for_status()
    # Ollama's JSON-schema mode made this model answer "no runners", so parse its free-text JSON instead
    text = resp.json()["choices"][0]["message"]["content"]
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group(0)).get("runners", [])
    except json.JSONDecodeError:
        # Cut off at MAX_ANSWER_TOKENS: keep the runner entries that were completed
        runners = []
        for obj in re.findall(r"\{[^{}]*\}", text):
            try:
                runners.append(json.loads(obj))
            except json.JSONDecodeError:
                pass
        return runners


def drop_counting(pairs):
    """Drop (bib, name) pairs where the model was counting rather than reading bibs.

    Runs of MIN_RUN or more numbers in equal steps (1000, 1001, 1002, ... or 111, 110, 109, ...
    or 117, 127, 137, ...) in the order the model gave them, with the same name or none, aren't
    real bibs. Runners who entered together can have consecutive numbers, but not the same name.
    """
    nums = [int(b) if b.isdigit() else None for b, _ in pairs]
    bad = set()
    i = 0
    while i < len(nums) - 1:
        j = i + 1
        if None not in (nums[i], nums[j]) and nums[i] != nums[j]:
            step = nums[j] - nums[i]
            while j + 1 < len(nums) and nums[j + 1] is not None and nums[j + 1] - nums[j] == step:
                j += 1
            names = {n for _, n in pairs[i:j + 1]} - {"", "UNKNOWN"}
            if j - i + 1 >= MIN_RUN and len(names) <= 1:
                bad.update(range(i, j + 1))
        i = j
    return [p for i, p in enumerate(pairs) if i not in bad]


def read_bibs(session, url, path, model, max_side, tiles):
    found = {}
    for image in views(path, max_side, tiles):
        pairs = [(re.sub(r"\D", "", str(r.get("bib", ""))).lstrip("0"), str(r.get("name", "")).strip().upper())
                 for r in ask_model(session, url, image, model) if isinstance(r, dict)]
        for bib, name in drop_counting(pairs):
            if name == "UNKNOWN":
                name = ""
            if bib and (bib not in found or not found[bib]):
                found[bib] = name
    return drop_partial(found)


def drop_partial(found):
    """A bib cut off at an image edge can be misread as a shorter number ("100" for "1008"), so drop a
    number that is part of a longer one in the same photo unless it has a different runner's name."""
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
            for bib, name in drop_counting(list(zip(bibs, row_names))):
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
    parser.add_argument("--url", default=DEFAULT_URL,
                        help="OpenAI-compatible chat endpoint (default llama-server on port 8080)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-side", type=int, default=1600,
                        help="longest side of each image sent to the model; above ~1600 it no longer fits on an 8 GB GPU")
    parser.add_argument("--tiles", type=int, default=0,
                        help="also send N overlapping close-up strips per photo: finds some smaller bibs, "
                             "but ~5x slower and adds more misreads (try 2)")
    parser.add_argument("--limit", type=int, help="only process this many new photos (for testing)")
    parser.add_argument("--max-temp", type=int, default=80,
                        help="pause when the GPU gets hotter than this (C, default 80)")
    parser.add_argument("--resume-temp", type=int, default=72,
                        help="after pausing, wait until the GPU has cooled to this (C, default 72)")
    parser.add_argument("--rest", type=float, default=3,
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
                found = read_bibs(session, args.url, path, args.model, args.max_side, args.tiles)
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
            rate = i / (time.time() - started) * 3600  # photos/hour so far, including thermal pauses
            summary = ", ".join(f"{b} {n}".strip() for b, n in found.items()) or "none"
            taken = taken_at(path)
            print(f"[{i}/{len(todo)}] {row['album']}/{path.name}{f' @ {taken}' if taken else ''}: "
                  f"{summary} ({secs:.1f}s, {rate:.0f} photos/h, ~{(len(todo) - i) / rate:.1f}h left)",
                  flush=True)
            if args.rest:
                time.sleep(args.rest)

    if results_path.exists():
        write_by_bib(results_path, results_path.with_name("by_bib.csv"))


if __name__ == "__main__":
    main()
