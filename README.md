# Abingdon Marathon 2026 photos

Downloads the official race photos from Flickr (8 albums, 14,470 photos) and uses a local
vision model to read the race (bib) number on each runner, so you can find every photo of a runner.

## Usage
```
python download_album.py                 # all 8 albums, 1600px copies -> photos\<album name>\
python download_album.py --large         # ~4000px copies instead (very slow, see below)
python download_album.py --originals     # untouched originals instead (very slow, see below)
python download_album.py <album url> ... # other public Flickr albums

python read_bibs_2pass.py --skip bibs.csv   # recommended: finds runners first, see below
python read_bibs.py --limit 50           # quick accuracy/speed check first
python read_bibs.py                      # full run -> bibs.csv and by_bib.csv
python read_bibs.py --tiles 2 --out bibs_tiles.csv   # slower close-up pass, see below
python read_bibs.py --max-temp 70 --resume-temp 60 --rest 3   # run cooler (and slower), see Speed
python compare_bibs.py bibs.csv bibs_new.csv   # agreement and speed of two runs on the same photos
```
Both scripts can be stopped and re-run at any time: photos already downloaded / already in
`bibs.csv` are skipped. `read_bibs.py` only processes photos that are already downloaded, so it
can run while the download is still going.

Needs Python 3.11 with `requests` and `Pillow`, and a vision model served by
[llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server` (Windows CUDA build from its releases page):
```
llama-server -hf ggml-org/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M -ngl 99 -c 8192 -fa on --port 8080
```
`-hf` downloads the model and its vision encoder (mmproj) on first run. Ollama still works through
its OpenAI-compatible endpoint: `ollama pull qwen2.5vl:7b`, then pass
`--url http://localhost:11434/v1/chat/completions` (set `OLLAMA_CONTEXT_LENGTH=4096` before starting it).

## Website
`site/` is a static React + TypeScript app for finding photos by race number or name; see
`WEBSITE_PLAN.md`. Images are hotlinked from Flickr, so the site only publishes an index:
```
python fetch_results.py                  # official results -> results.csv
python build_index.py                    # Flickr listing and tags + bibs*.csv + results.csv -> site/public/data/photos.json
cd site && npm install && npm run dev    # try it locally
```
Commit and push `site/public/data/photos.json` to publish: the GitHub Actions workflow builds the
site and deploys it to GitHub Pages on every push to `main`. Re-run `build_index.py` and push again
as `read_bibs.py` gets through more photos.

`build_index.py` also works out how far each camera's clock is out, from runners whose numbers were
read, corrects the photo times of finish albums whose clocks are clearly wrong (Finish a and c), and
estimates when every finisher passed each place from their chip times. Runner pages list the photos taken within seconds of a runner passing the finish and the Mile 26 track, and link to
the other albums at about the right moment.

## Albums
| Album | Photos |
|---|---|
| 2026 Start | 92 |
| 2026 Mile 5 | 1,322 |
| 2026 Miles 11 & 19.5 | 2,562 |
| 2026 Mile 24 | 1,746 |
| 2026 Mile 26 (track) | 4,587 |
| 2026 Finish a | 1,903 |
| 2026 Finish b | 2,106 |
| 2026 Finish c | 152 |

The short links are in `DEFAULT_ALBUMS` in `download_album.py`.

## Outputs
- `photos\<album>\*.jpg`: named `<camera file name>_<Flickr photo id>.jpg`, e.g. `DSC_2787_55599328821.jpg`
- `photos\<album>\manifest.csv`: file, Flickr photo id, album and Flickr page URL for every photo
- `bibs.csv`: one row per processed photo: race numbers and names read (`;`-separated), Flickr link, seconds taken
- `by_bib.csv`: one row per race number and photo, sorted by number, to look up a runner's photos

## How the download works
- Flickr's album web pages stop after ~450 photos, so the script lists albums through the Flickr
  API using the public key embedded in Flickr's own pages (no account or API key of your own).
- **Image size:** by default it downloads Flickr's 1600px copy (`h`, ~400 KB, about 6 GB in total).
  That is all `read_bibs.py` uses anyway: it shrinks every photo to 1600px. `--large` downloads
  Flickr's largest resized copy (`4k`/`3k`, etc.) instead: the same or nearly the same pixel size as
  the original (e.g. 4096×2731 vs 4176×2784), just more compressed: ~1 MB instead of ~3.5 MB.
  For prints, it's quicker to fetch large copies of just the photos of the runners you want.
- **Rate limiting:** Flickr's image server (`live.staticflickr.com`) blocks your IP address (HTTP 429)
  above roughly 85 large copies or originals per hour. Short bursts get further (~310 at 1 photo/s)
  but are then blocked for an hour or more. 1600px copies weren't blocked at all: 600 in a row at
  1 photo/s in a test, then ~350 more in 5 minutes. The limit is on the IP address: the download links
  carry no API key or login, so using your own Flickr API key or another tool (e.g. flickrdump)
  doesn't change it. Avoid Flickr's `_d` ("download") links: they are limited even harder
  (see gallery-dl issue #8297). Photos already downloaded at a larger size are kept and skipped.
- **How the script copes:** downloads share one rate limit, starting at 1 photo/s for 1600px copies
  and one every 45 s (80/hour) for `--large` and `--originals`. On a 429 every worker pauses (60 s,
  doubling to a maximum of 10 min while still blocked) and the rate drops by a third. Every 25 photos
  in a row without a 429 it speeds up 10%, back up to the starting rate (90/hour for large copies).
  Refused photos are retried, not skipped. The full set takes ~4 hours at 1600px, or about a week
  with `--large`. Run `read_bibs.py` alongside it.

## How bib reading works
- Each photo is turned upright (many are stored sideways with an EXIF rotation flag), shrunk to
  1600px on the long side and sent to `qwen2.5vl:7b` asking for each bib's number and first name as JSON.
- 1600px is the most that fits on this laptop's RTX 3070 Ti (8 GB). At 2048px the model spills
  out of GPU memory and takes ~100 s per photo.
- Things that went wrong in testing and are now handled:
  - Ollama's JSON-schema (`format`) mode made the model always answer "no runners". The script
    asks for plain text and extracts the JSON from it.
  - The model copied the example values from the prompt (a real-looking "1045 MARK") into answers for
    photos with no bibs. The example now uses placeholders.
  - A strict "skip anything unclear" prompt missed obvious bibs. The prompt is now more relaxed.
- `--tiles N` also sends N overlapping close-up strips of each photo. It found a few extra small
  bibs, but it is ~5× slower and added wrong numbers. Numbers that are part of a longer number
  in the same photo (e.g. "100" vs "1008", from a bib cut off at a strip edge) are dropped unless
  they have a different name. Best used as a second pass on photos where nothing was found.
- `read_bibs_2pass.py` finds the runners first with a small person detector (YOLO, on the CPU),
  then sends one contact sheet of their torsos, 640 px tall each. On the first 100 photos, through
  llama-server, it read more bibs whose number and first name both match a finisher than
  `read_bibs.py` did through Ollama (87 vs 80), with fewer misreads, at ~3.1 s vs ~3.6 s per photo.
  `--crop-height 480` is ~2.1 s and finds as many numbers, but reads fewer names. The trade-offs
  are in its docstring; `compare_bibs.py` compares two runs.

### Accuracy (28 photos checked by eye)
- Clearly visible bibs: read correctly, including busy group shots with 4–5 runners.
- Partly hidden bibs (hands, arms, other runners) sometimes give a wrong number, e.g. "145" for a
  bib showing "14?". Treat the results as a way to find photos, not as exact.
- Names are less reliable: sometimes it gives a club name ("WOKING A.C.") or text from the runner's top.

### Speed
| Mode | Per photo | Full set (14,470) |
|---|---|---|
| Whole photo (default) | 2.9 – 6.4 s, typically ~4 s | 12 – 26 h, typically ~16 h |
| `--tiles 2` | 14 – 25 s | 55 – 100 h |

Based on about 10 photos per mode that the model hadn't seen before. Repeat runs on the same
images are much faster because the server reuses its earlier work, so don't time with photos that
have already been processed. The GPU slows down when it gets hot: keep the laptop in the HP
"Performance" profile and on the charger. The script prints a time-remaining estimate after every photo.

To keep the laptop from running hot for hours, `read_bibs.py` checks the GPU temperature with
`nvidia-smi` before each photo. Above `--max-temp` (default 80°C) it pauses until the GPU is down
to `--resume-temp` (default 72°C), giving up waiting after 15 minutes. With 70°C / 60°C the GPU spent
about three-quarters of the time cooling down (it reached 70°C within a minute of work). `--rest N` adds N seconds
after every photo, so the GPU runs cooler all the time: with photos taking ~4 s, `--rest 4` roughly
halves the heat and doubles the run time.

## Notes
- Changing `--tiles`, the prompt or the model doesn't reprocess photos already in `bibs.csv`.
  Use a new `--out` file to redo them.
- Don't run two copies of `read_bibs.py` on the same output file: they would duplicate rows.
- For the true originals, the simplest route is to ask Abingdon Marathon for them directly.
