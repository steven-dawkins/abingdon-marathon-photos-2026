# Abingdon Marathon 2026 photo finder: website plan

A static website where a runner types their race number or name and sees every photo of
themselves from the official Flickr albums, with full-size downloads. No server: a Python
build step produces JSON, a React + TypeScript app reads it, and GitHub Pages hosts it.
The images themselves stay on Flickr and are hotlinked.

## 1. What's already established

### Hotlinking Flickr works (checked 2026-10-23)
- Every photo has stable image URLs on `live.staticflickr.com`:
  `https://live.staticflickr.com/{server}/{id}_{secret}_{size}.jpg`
- **The secret is not the same for every size.** Sizes up to 1024px (`q` 150 square, `n` 320,
  `z` 640, `b` 1024) share one secret; `h` (1600), `k` (2048) and `o` (original) each have their
  own. The photos' `manifest.csv` files don't record any secrets, so the build step has to
  fetch them from the Flickr API: 29 calls of 500 photos for all 14,470 photos.
- Images are served with `Access-Control-Allow-Origin: *` and `Cache-Control: max-age=31536000`.
  So the browser can `fetch()` an original as a blob and save it under a sensible filename,
  or add it to a zip. Without that, cross-origin `<a download>` links just open the image.
- Licence: **All rights reserved**, with downloads enabled (`candownload=1`). Hotlinking with
  a credit and a link back to each photo's Flickr page is how Flickr expects photos to be shown
  elsewhere. You've confirmed the organiser is OK with a public site.
- Rate limits (see README): thumbnails and 1600px copies weren't limited in testing. Originals
  are limited to about 85 per hour **per IP address**. On this site, each visitor's own browser
  makes the requests, so the limit applies per visitor, not to the site as a whole. One runner
  saving their 5–20 photos is fine. Zipping 100+ originals isn't.

### Official results (done: `fetch_results.py` → `results.csv`)
- The ChronoTrack page is a front end for a public JSON API
  (`reignite-api.athlinks.com/azp/ctlive/event/94541/race/251135/results`), so no scraping is needed.
- 1,013 finishers: bib, full name, gender, age, club (608 have none), position, chip/gun time,
  start and finish clock times. **There are no split times and no DNF/DNS entries.**
- Cross-check against the first 675 photos processed by `read_bibs.py` (856 bib reads):
  - 620 (72%): the bib is a finisher's **and** the first name read off the bib matches theirs → high confidence
  - 168: the bib is a finisher's but the name doesn't match → probably a misread number
  - 54: the bib isn't any finisher's → misread, or a non-finisher
  - 14: a finisher's bib, but no name was read

  This gives each match a confidence level for free, and lets a misread bib sometimes be
  corrected: e.g. "145" read with the name "SARAH" when bib 146 is Sarah.

## 2. Architecture

```
Flickr API ──┐
bibs.csv ────┼─► build_index.py ─► site/public/data/photos.json ─► Vite build ─► GitHub Pages
results.csv ─┘                                                     (React + TS)
                       browser ──hotlinks──► live.staticflickr.com (thumbnails, originals)
```

- **Python build step** (`build_index.py`, alongside the existing scripts): re-runnable, and run
  again whenever `read_bibs.py` has processed more photos.
- **Front end** (`site/`): Vite + React 19 + TypeScript, no UI framework, plain CSS modules.
  - `HashRouter`, so deep links (`/#/bib/1234`) work on GitHub Pages without 404 tricks
  - `fflate` to build zips in the browser (smaller and faster than JSZip)
  - Name search with a hand-rolled normalised prefix/substring match (1,013 names is tiny);
    add `fuse.js` only if typo tolerance turns out to matter
- **Hosting:** GitHub Pages, deployed by a GitHub Actions workflow that builds `site/` on push.
  `photos/` (6 GB) and the working CSVs are `.gitignore`d; only `photos.json` is committed.

## 3. Data: `photos.json`

One file, loaded once. ~14.5k photos × ~90 bytes ≈ 1.3 MB raw, ~350 KB gzipped (GitHub Pages
gzips JSON). Splitting it per bib isn't worth the complexity: loading everything at once also
gives browsing and the "nearby photos" feature below without extra requests.

```ts
interface PhotoIndex {
  generated: string;                 // ISO timestamp
  owner: string;                     // Flickr user id, for photo page links
  albums: Album[];                   // in course order
  runners: Runner[];                 // from results.csv
  photos: Photo[];                   // sorted by album, then time taken
}
interface Album  { id: string; title: string; label: string; order: number }  // label e.g. "Mile 24"
interface Runner { bib: string; name: string; club?: string; time: string; pos: number }
interface Photo {
  id: string;                        // Flickr photo id
  a: number;                         // album index
  s: string;                         // server
  k: string;                         // secret for q/n/z/b sizes
  ok: string;                        // secret for the original
  w: number; h: number;              // original size (layout without reflow, and the download label)
  t: number;                         // time taken, seconds since race start (camera clock, corrected for finish albums, see risks)
  r?: 1;                             // checked by read_bibs.py (even if no bibs were found)
  b?: [bib: string, conf: 0 | 1 | 2 | 3][];  // bibs read; 3 = number + name match, 2 = finisher's number or corrected,
                                            // 1 = name matches, number read is part of theirs, 0 = unknown number
}
```

Short keys keep the file small; the app maps them to readable types in one place (`data.ts`).

Course order of the albums: Start → Mile 5 → Miles 11 & 19.5 → Mile 24 → Mile 26 (track) →
Finish a/b/c.

`build_index.py` steps:
1. List all 8 albums through the Flickr API (reusing `resolve_album` / `get_with_retry` from
   `download_album.py`) with `extras=url_o,date_taken,o_dims`; take secrets from the `url_q` and `url_o` values.
2. Join `bibs.csv` on photo id. Photos not yet processed by `read_bibs.py` stay in the index
   without bibs, so they can still be browsed.
3. Score each bib read against `results.csv` (confidence 0/1/2 as above), and correct a
   misread bib when its name matches exactly one finisher whose number is one digit away
   (confidence 1: these look right, but common names make them a guess).
4. Write the JSON, and print coverage stats (photos processed, finishers with ≥1 photo).

## 4. Front end

### Pages
| Route | Content |
|---|---|
| `/#/` | Search box (bib or name), short explanation, coverage stats, credit to the photographer/organiser |
| `/#/bib/:bib` | Runner header (name, club, time, position), their photos grouped by course point in course order, "Download all" |
| `/#/photo/:id` | Large view (`b` 1024px, `h` 1600px on big screens), runners spotted in it (each a link), Download, View on Flickr, previous/next photo in the same album |
| `/#/album/:i` | Browse one album in time order (virtualised grid of thumbnails) |

### Search
- Only digits → exact bib match, with suggestions as you type.
- Text → match against the official names (accent- and case-insensitive, any word prefix:
  "jo smi" finds "John Smith"). A list of matches with club and time to pick from.
- A bib with no finisher entry (a DNF, or a misread) still shows any photos read with that
  number, labelled as unconfirmed.

### Runner page
- Confident matches first, then "possibly you" (confidence 0/1), visually separated.
- **"Look for more photos of me":** the bib reader misses some photos (bibs hidden, side-on
  shots). For each course point where the runner was found, a link opens that album's
  timeline at the runner's photo, so they can scroll through the neighbouring shots. Where the
  runner has no photo at a point, a time estimate can be added later (see Phase 4).

### Downloads
- **Single photo:** `fetch(url_o)` → blob → save as
  `Abingdon-Marathon-2026_<bib>_<album label>_<photo id>.jpg`.
- **Download all:** fetch the originals one after another (1 at a time, ~1 s apart) into an
  `fflate` zip with a progress bar, then save the zip. If Flickr returns 429, pause and retry
  with backoff, like `download_album.py`, and tell the user it's waiting on Flickr's limit. For
  more than ~60 photos, warn that it may take a while (most runners will have far fewer).
- Every photo links to its Flickr page and shows the credit "Photos © the Abingdon Marathon
  photographers and organisers, via Flickr". The home and about text uses the same general credit,
  naming no individual photographer (there are several).

### Other details
- Thumbnails use `loading="lazy"`, with `srcset` choosing `n` (320) or `z` (640).
- Mobile-first layout: most visitors will come from a phone via a link from the race's
  socials or email.
- A "Wrong or missing photo?" link on runner and photo pages opens a new GitHub issue,
  prefilled with the bib, photo id and Flickr link. The repo URL comes from `GITHUB_REPOSITORY`
  in the deploy workflow (`VITE_REPO`), so nothing is hard-coded.
- Vite `base: "./"` plus `HashRouter`, so the build works under any GitHub Pages path or a custom domain.
- Plain neutral styling for now; no Abingdon Marathon logo or colours.
- No analytics or cookies unless you want them.

## 5. Repo layout

```
abingdon_marathon_photos/
  download_album.py  read_bibs.py  fetch_results.py  build_index.py
  README.md  WEBSITE_PLAN.md  .gitignore          # ignores photos/ (6 GB)
  site/
    index.html  package.json  vite.config.ts  tsconfig.json
    public/data/photos.json
    src/ main.tsx  App.tsx  data.ts  flickr.ts  search.ts  download.ts
         pages/{Home,Runner,Photo,Album}.tsx  components/{SearchBox,PhotoGrid,Lightbox,DownloadAll}.tsx
  .github/workflows/deploy.yml
```

## 6. Phases

1. **Data:** `build_index.py` and `photos.json` from the photos processed so far. Check the
   sizes and the Flickr URLs.
2. **App MVP:** search, runner page, photo page, single download, run locally with `npm run dev`.
3. **Download all + album browsing**, mobile polish, credit/about text. Done: albums load more
   photos as you scroll, have a "Jump to" time picker and label each thumbnail with its time and
   the bibs read; swipe and preloading on the photo page; Share button; About page.
4. **Time-based help:** done. `build_index.py` corrects an even-pace estimate of when each runner
   passed each place by the median error for matched runners with similar finish times (which
   covers both the camera clock and real pacing). Finish and Mile 26 estimates are good to a few
   seconds, so runner pages list those photos; elsewhere (±2–8 min) they link to the album at that moment.
5. **Deploy:** go live as soon as phases 1–2 work, with whatever photos are processed by then.
   After that, re-run `build_index.py` and push `photos.json` as `read_bibs.py` progresses; the
   workflow redeploys on every push. (Phases 3–4 follow as later pushes.)

## 7. Risks and notes
- **Bib reading is only ~5% done** (675 of 14,470 photos). The site goes live anyway and the
  home page shows how many photos have been processed so far, so a runner with no matches yet
  knows to come back (or browse the albums).
- **Camera clocks (checked 2026-10-25 against finish times):** Finish a is about 170 s fast and
  Finish c about 1 h 52 min slow. Finish b and Mile 26 photos are taken 65–95 s before runners cross
  the line, so those cameras are on the course or nearly right. `build_index.py` corrects finish albums
  more than 2 minutes out (Finish a and c) by the median gap to the matched runners' finish times, and
  album pages say so.
- If a photographer replaces or re-uploads photos on Flickr, their secrets change and the
  links break: re-run `build_index.py`.
- The Flickr site key `download_album.py` scrapes is only used at build time. It is never
  shipped to the browser.
- Results include ages. The site won't show ages, only name, club, time and position (all
  public on ChronoTrack anyway).

## 8. Decisions (2026-10-23)
- **One race:** event 94541 is just the marathon (race 251135).
- **GitHub:** you add the remote before work starts; the site doesn't depend on the repo name or domain.
- **Credit:** general credit to all the photographers and the Abingdon Marathon organisers.
  No logo or colours for now.
- **Reports:** wrong or missing photos are reported through GitHub issues.
- **Go-live:** publish now, push more as more photos are processed.
- **Hiding runners:** not supported for now; everything shown is already public. A bib exclude
  list in `build_index.py` can be added if anyone asks.
