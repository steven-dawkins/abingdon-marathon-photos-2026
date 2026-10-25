"""Read race (bib) numbers in two passes: find the runners first, then read all their bibs close up at once.

Usage:
    python read_bibs_2pass.py [photos_dir] [--limit N] [--crop-height PX] [--min-height F] [--url URL]
                              [--model NAME] [--max-temp C] [--resume-temp C] [--rest SECONDS] [--out bibs_2pass.csv]
                              [--skip bibs.csv ...]

A small person detector (YOLO, on the CPU so it doesn't compete with the vision model for GPU memory) finds
the runners. Each runner's torso is cut from the full-size photo and the crops are packed into one
small contact sheet, which the vision model reads in a single call. The sheet costs about half the
image tokens of read_bibs.py's whole 1600 px photo, yet each bib gets as many pixels as before or
more, and photos with no runners skip the model entirely. Full-size photos
(download_album.py --large) give sharper crops at no extra cost.

Ollama sends the model at least ~1,150 image tokens however small the image is, so one call per
runner would be slower than one call per photo: that's why the crops share one sheet. (Not yet
measured with llama-server, which may allow fewer.)

Writes the same columns as read_bibs.py, to bibs_2pass.csv by default so the two can be compared;
pass --out bibs.csv to use it for the site. Like read_bibs.py it can be stopped and re-run.
--skip bibs.csv also skips the photos read_bibs.py has already done (e.g. to share the work).
Needs: pip install ultralytics (the detector's weights download on first run).
"""

import argparse
import csv
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image, ImageOps

from read_bibs import (DEFAULT_MODEL, DEFAULT_URL, FIELDS, ask_model, cool_down, drop_counting, drop_partial, gpu_temp,
                       load_photos, taken_at, to_base64, write_by_bib)

DETECTOR = "yolo11n.pt"  # smallest YOLO model: ~0.1-0.3 s per photo on the CPU
DETECT_SIDE = 960  # the detector's input size; bigger finds more distant runners but is slower
PERSON = 0  # COCO class id
MIN_CONFIDENCE = 0.4
MAX_RUNNERS = 10  # the biggest people in a crowded photo; the rest are too far away to read
# The bib is pinned anywhere from the chest to the shorts: this band of the person's box, plus a margin either side
TORSO_TOP, TORSO_BOTTOM, SIDE_MARGIN = 0.10, 0.80, 0.08
EDGE = 0.01  # a person's box this close (fraction of the photo) to its top or bottom is cut off by the frame
SHEET_WIDTH = 1200  # crops are laid out in rows up to this wide
GAP = 16  # white space between crops, so the model sees them as separate pictures

PROMPT = """This image is a grid of close-ups of runners in a marathon, separated by white space.
Read the race number on each runner's bib, with the first name printed below it.
Ignore bibs where the number is mostly hidden, and people without a bib.
Answer only with JSON like {"runners": [{"bib": "<number>", "name": "<first name>"}]},
or {"runners": []} if there are no readable bibs."""


def load_detector():
    from ultralytics import YOLO  # slow import, so only when it's needed
    return YOLO(DETECTOR)


def runner_crops(detector, path, crop_height, min_height):
    """Crops of each detected person's torso from the full-size photo, biggest first, all crop_height tall."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")  # many photos are stored sideways
    w, h = im.size
    result = detector.predict(im, imgsz=DETECT_SIDE, classes=[PERSON], conf=MIN_CONFIDENCE,
                              device="cpu", verbose=False)[0]
    boxes = [b for b in result.boxes.xyxy.tolist() if b[3] - b[1] >= min_height * h]
    boxes.sort(key=lambda b: b[3] - b[1], reverse=True)
    crops = []
    for x1, y1, x2, y2 in boxes[:MAX_RUNNERS]:
        bw, bh = x2 - x1, y2 - y1
        # For a close-up runner cut off by the frame the box isn't their whole body, so the torso
        # band would miss a bib pinned low: keep everything up to the edge instead
        top = y1 if y1 <= EDGE * h else y1 + TORSO_TOP * bh
        bottom = h if y2 >= (1 - EDGE) * h else y1 + TORSO_BOTTOM * bh
        box = (max(0, x1 - SIDE_MARGIN * bw), top, min(w, x2 + SIDE_MARGIN * bw), bottom)
        crop = im.crop(tuple(round(v) for v in box))
        # Small, distant runners are enlarged so their digits get more pixels
        scale = min(crop_height / crop.height, SHEET_WIDTH / crop.width)
        crops.append(crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
                                 Image.LANCZOS))
    return crops


def contact_sheet(crops):
    """Pack the crops into rows on a white background."""
    rows, row, width = [], [], 0
    for crop in crops:
        if row and width + GAP + crop.width > SHEET_WIDTH:
            rows.append(row)
            row, width = [], 0
        width += (GAP if row else 0) + crop.width
        row.append(crop)
    rows.append(row)
    row_height = max(c.height for c in crops)
    sheet = Image.new("RGB", (max(sum(c.width for c in r) + GAP * (len(r) - 1) for r in rows),
                              row_height * len(rows) + GAP * (len(rows) - 1)), "white")
    for i, r in enumerate(rows):
        x = 0
        for crop in r:
            sheet.paste(crop, (x, i * (row_height + GAP)))
            x += crop.width + GAP
    return sheet


def read_bibs(session, url, crops, model):
    if not crops:
        return {}
    sheet = contact_sheet(crops)
    pairs = [(re.sub(r"\D", "", str(r.get("bib", ""))).lstrip("0"), str(r.get("name", "")).strip().upper())
             for r in ask_model(session, url, to_base64(sheet, max(sheet.size)), model, PROMPT)
             if isinstance(r, dict)]
    found = {}
    for bib, name in drop_counting(pairs):
        if name == "UNKNOWN":
            name = ""
        # Neighbouring people's crops overlap, so the same bib can appear twice
        if bib and (bib not in found or not found[bib]):
            found[bib] = name
    return drop_partial(found)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("photos_dir", nargs="?", default="photos")
    parser.add_argument("--url", default=DEFAULT_URL,
                        help="OpenAI-compatible chat endpoint (default llama-server on port 8080)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--crop-height", type=int, default=320,
                        help="height of each runner's crop on the contact sheet (default 320)")
    parser.add_argument("--min-height", type=float, default=0.15,
                        help="skip runners shorter than this fraction of the photo's height: too far away "
                             "to read (default 0.15)")
    parser.add_argument("--limit", type=int, help="only process this many new photos (for testing)")
    parser.add_argument("--max-temp", type=int, default=70,
                        help="pause when the GPU gets hotter than this (C, default 70)")
    parser.add_argument("--resume-temp", type=int, default=60,
                        help="after pausing, wait until the GPU has cooled to this (C, default 60)")
    parser.add_argument("--rest", type=float, default=0,
                        help="seconds to pause after every photo, to run cooler overall (default 0)")
    parser.add_argument("--out", default="bibs_2pass.csv")
    parser.add_argument("--skip", nargs="+", default=[], metavar="CSV",
                        help="also skip photos already listed in these results files, e.g. bibs.csv")
    args = parser.parse_args()

    photos_dir = Path(args.photos_dir)
    results_path = Path(args.out)
    done = set()
    for path in [results_path, *map(Path, args.skip)]:
        if path.exists():
            with open(path, newline="", encoding="utf-8") as f:
                done |= {(r["album"], r["file"]) for r in csv.DictReader(f)}

    todo = [(p, row) for p, row in load_photos(photos_dir) if (row["album"], row["file"]) not in done]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(done)} photos already done, {len(todo)} to process")

    temp = gpu_temp()
    print(f"GPU at {temp}C, pausing above {args.max_temp}C" if temp is not None
          else "Can't read the GPU temperature (nvidia-smi not found): no thermal pauses")

    detector = load_detector()
    session = requests.Session()
    new_file = not results_path.exists()
    # Find the runners in the next photo on the CPU while the GPU reads this one's bibs
    with open(results_path, "a", newline="", encoding="utf-8") as f, ThreadPoolExecutor(1) as pool:
        writer = csv.DictWriter(f, FIELDS)
        if new_file:
            writer.writeheader()
        detect = lambda path: runner_crops(detector, path, args.crop_height, args.min_height)
        upcoming = pool.submit(detect, todo[0][0]) if todo else None
        started = time.time()
        for i, (path, row) in enumerate(todo, 1):
            cool_down(args.max_temp, args.resume_temp)
            t0 = time.time()
            current = upcoming
            upcoming = pool.submit(detect, todo[i][0]) if i < len(todo) else None
            try:
                crops = current.result()
                found = read_bibs(session, args.url, crops, args.model)
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
                  f"{summary} ({len(crops)} runners, {secs:.1f}s, ~{eta:.1f}h left)")
            if args.rest:
                time.sleep(args.rest)

    if results_path.exists():
        write_by_bib(results_path, results_path.with_name("by_bib_2pass.csv"))


if __name__ == "__main__":
    main()
