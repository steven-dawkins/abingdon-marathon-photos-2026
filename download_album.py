"""Download every photo from one or more public Flickr albums.

Usage:
    python download_album.py [--large | --originals] [album_url ...]

By default it downloads Flickr's 1600px copy of each photo (~380 KB). Flickr lets those through
at 1 photo/s or more, so the full set takes a few hours.
--large downloads Flickr's largest resized copy instead: the same (or almost the same) pixel size
as the original, just more compressed (~1 MB instead of ~3.5 MB). --originals downloads the
untouched originals. Flickr only allows ~85 of either per hour, so the full set takes about a week.

Defaults to the Abingdon Marathon 2026 albums listed in DEFAULT_ALBUMS.
Each album is saved to its own subfolder of ./photos, named after the album.
Uses the public API key embedded in Flickr's own web pages to list the
album via the API, so you don't need your own Flickr API key.
Re-running skips files that were already downloaded.
"""

import csv
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

DEFAULT_ALBUMS = [
    "https://flic.kr/s/aHBqjD88rD",
    "https://flic.kr/s/aHBqjD87hj",
    "https://flic.kr/s/aHBqjD7YeP",
    "https://flic.kr/s/aHBqjD84FM",
    "https://flic.kr/s/aHBqjD7YUr",
    "https://flic.kr/s/aHBqjD83ud",
    "https://flic.kr/s/aHBqjD7XXB",
    "https://flic.kr/s/aHBqjD812W",
]
DEFAULT_OUT = "photos"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
WORKERS = 4
# Flickr's image server blocks an IP address (HTTP 429) above roughly 85 large copies or originals
# per hour. 1600px copies weren't blocked at all at 1 photo/s (600 in a row). The rate adapts: each
# 429 slows it by a third, and every SPEEDUP_EVERY photos in a row without one speeds it up 10%, so
# it settles just under Flickr's limit. Seconds between photos (start, fastest, slowest):
FAST_PACE = (1, 1, 90)  # 1600px copies: ~3600 photos/hour
SLOW_PACE = (45, 40, 90)  # large copies and originals: 80 photos/hour, between 40 and 90
SPEEDUP_EVERY = 25
BACKOFF_START = 60  # first pause after a 429, doubling while Flickr is still blocking
BACKOFF_MAX = 10 * 60
MAX_RATE_LIMIT_RETRIES = 20

SITE_KEY_RE = re.compile(r'site_key = "([0-9a-f]+)"')
ALBUM_RE = re.compile(r"/photos/([^/]+)/(?:sets|albums)/(\d+)")
UNSAFE_CHARS_RE = re.compile(r'[<>:"/\\|?*]')
API_URL = "https://api.flickr.com/services/rest/"
# Flickr size codes, largest first. Avoid the "_d" download variants: Flickr limits those much harder.
LARGE_SIZES = ["6k", "5k", "4k", "3k", "k", "h", "b"]
DEFAULT_SIZES = ["h", "b"]  # 1600px, falling back to 1024px


def safe_name(text):
    return UNSAFE_CHARS_RE.sub("_", text or "").strip().rstrip(".")


def get_with_retry(session, url, **kwargs):
    """GET that backs off and retries when Flickr rate-limits (429/5xx)."""
    for attempt in range(6):
        resp = session.get(url, timeout=30, **kwargs)
        if resp.status_code not in (429, 500, 502, 503, 504):
            break
        wait = 10 * 2 ** attempt
        print(f"  Flickr returned {resp.status_code}, retrying in {wait}s...")
        time.sleep(wait)
    resp.raise_for_status()
    return resp


def resolve_album(session, url):
    """Follow the short link and return (user_id, album_id, site_api_key)."""
    resp = get_with_retry(session, url)
    user_id, album_id = ALBUM_RE.search(resp.url).groups()
    key = SITE_KEY_RE.search(resp.text).group(1)
    return user_id, album_id, key


def collect_photo_urls(session, user_id, album_id, api_key, sizes):
    """Return (album_title, {filename_stem: image_url}) for the album. sizes=None means originals."""
    photos = {}
    title = album_id
    page, pages = 1, 1
    while page <= pages:
        resp = get_with_retry(session, API_URL, params={
            "method": "flickr.photosets.getPhotos",
            "api_key": api_key,
            "photoset_id": album_id,
            "user_id": user_id,
            "extras": ",".join(f"url_{s}" for s in ["o", *LARGE_SIZES]) + ",original_format",
            "per_page": 500,
            "page": page,
            "format": "json",
            "nojsoncallback": 1,
        })
        data = resp.json()
        if data.get("stat") != "ok":
            raise RuntimeError(f"Flickr API error: {data}")
        pages = data["photoset"]["pages"]
        title = data["photoset"].get("title") or album_id
        for p in data["photoset"]["photo"]:
            url = p.get("url_o") or (
                f"https://live.staticflickr.com/{p['server']}/{p['id']}_{p['originalsecret']}_o.{p['originalformat']}"
            )
            if sizes:
                url = next((p[f"url_{s}"] for s in sizes if p.get(f"url_{s}")), url)
            name = safe_name(p.get("title"))
            photos[f"{name}_{p['id']}" if name else p["id"]] = url
        print(f"  page {page}/{pages}: found {len(photos)} of {data['photoset']['total']}")
        page += 1
    return title, photos


class Throttle:
    """Spaces out photo requests across all worker threads, and pauses them all when Flickr says 429."""

    def __init__(self, interval, min_interval, max_interval):
        self.lock = threading.Lock()
        self.interval = interval
        self.min_interval = min_interval
        self.max_interval = max_interval
        self.next_slot = 0.0
        self.paused_until = 0.0
        self.backoff = 0
        self.streak = 0

    def wait(self):
        while True:
            with self.lock:
                now = time.monotonic()
                slot = max(now, self.next_slot, self.paused_until)
                self.next_slot = slot + self.interval
            time.sleep(slot - now)
            with self.lock:
                if time.monotonic() >= self.paused_until:
                    return  # otherwise a 429 arrived while we slept: queue up again after the pause

    def rate_limited(self, retry_after):
        with self.lock:
            now = time.monotonic()
            if now < self.paused_until:
                return  # another thread already reacted to this burst of 429s
            self.backoff = min(max(self.backoff * 2, BACKOFF_START), BACKOFF_MAX)
            pause = max(retry_after or 0, self.backoff)
            self.paused_until = now + pause
            self.interval = min(self.interval * 1.5, self.max_interval)
            self.streak = 0
            print(f"  Rate limited by Flickr: pausing {pause:.0f}s, "
                  f"then {1 / self.interval:.2f} photos/s", flush=True)

    def succeeded(self):
        with self.lock:
            self.backoff = 0
            self.streak += 1
            if self.streak % SPEEDUP_EVERY == 0 and self.interval > self.min_interval:
                self.interval = max(self.interval / 1.1, self.min_interval)
                print(f"  No rate limiting for {self.streak} photos: "
                      f"speeding up to {1 / self.interval:.2f} photos/s", flush=True)


def retry_after_seconds(resp):
    value = resp.headers.get("Retry-After", "")
    return int(value) if value.isdigit() else None


def download(session, throttle, name, url, out_dir):
    dest = out_dir / f"{name}{Path(url).suffix}"
    if dest.exists() and dest.stat().st_size > 0:
        return name, "skipped"
    errors = rate_limits = 0
    while True:
        throttle.wait()
        try:
            with session.get(url, stream=True, timeout=60) as resp:
                if resp.status_code == 429:
                    rate_limits += 1
                    if rate_limits > MAX_RATE_LIMIT_RETRIES:
                        return name, "failed: still rate limited"
                    throttle.rate_limited(retry_after_seconds(resp))
                    continue
                resp.raise_for_status()
                tmp = dest.with_suffix(dest.suffix + ".part")
                with open(tmp, "wb") as f:
                    for chunk in resp.iter_content(1 << 16):
                        f.write(chunk)
                tmp.replace(dest)
            throttle.succeeded()
            return name, "ok"
        except requests.RequestException as e:
            errors += 1
            if errors >= 3:
                return name, f"failed: {e}"
            time.sleep(2 * errors)


def write_manifest(out_dir, title, user_id, photos):
    """Record each file's Flickr photo ID and page so later results can link back."""
    with open(out_dir / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "photo_id", "album", "flickr_url"])
        for name, url in photos.items():
            photo_id = Path(url).name.split("_")[0]
            writer.writerow([f"{name}{Path(url).suffix}", photo_id, title,
                             f"https://www.flickr.com/photos/{user_id}/{photo_id}/"])


def download_album(session, throttle, album, out_root, sizes):
    """Download one album into its own subfolder; return list of failed names."""
    user_id, album_id, api_key = resolve_album(session, album)
    title, photos = collect_photo_urls(session, user_id, album_id, api_key, sizes)
    out_dir = out_root / (safe_name(title) or album_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Album '{title}' ({len(photos)} photos) -> {out_dir}")
    write_manifest(out_dir, title, user_id, photos)

    failed = []
    with ThreadPoolExecutor(WORKERS) as pool:
        futures = [pool.submit(download, session, throttle, name, url, out_dir) for name, url in photos.items()]
        for i, fut in enumerate(as_completed(futures), 1):
            name, status = fut.result()
            if status.startswith("failed"):
                failed.append(name)
            print(f"  [{i}/{len(futures)}] {name}: {status}")

    print(f"Finished '{title}': {len(photos) - len(failed)} of {len(photos)} photos\n")
    return [f"{title}/{name}" for name in failed]


def main():
    args = sys.argv[1:]
    flags = {"--large", "--originals"}
    if "--originals" in args:
        sizes, pace = None, SLOW_PACE
    elif "--large" in args:
        sizes, pace = LARGE_SIZES, SLOW_PACE
    else:
        sizes, pace = DEFAULT_SIZES, FAST_PACE
    albums = [a for a in args if a not in flags] or DEFAULT_ALBUMS
    out_root = Path(DEFAULT_OUT)

    session = requests.Session()
    session.headers.update(HEADERS)
    throttle = Throttle(*pace)

    failed = []
    for n, album in enumerate(albums, 1):
        print(f"=== Album {n}/{len(albums)}: {album}")
        try:
            failed += download_album(session, throttle, album, out_root, sizes)
        except Exception as e:
            print(f"Could not download {album}: {e}\n")
            failed.append(album)

    print(f"Done. Photos are in {out_root.resolve()}")
    if failed:
        print(f"{len(failed)} failed (re-run to retry):")
        for name in failed:
            print(f"  {name}")


if __name__ == "__main__":
    main()
