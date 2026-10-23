# Possible improvements

Ideas for the photo finder after phases 1–3 (see `WEBSITE_PLAN.md`), roughly in order of value.
Written 2026-10-23, when 1,243 of 14,470 photos had been checked for race numbers.

## Finding more photos for each runner

1. **Finish the bib reading.** Only about 9% of photos have been checked, so most runners can't
   find themselves yet; nothing else here matters as much. About 15 h of GPU time is left (more
   with the thermal pauses). A small `publish.py` could rebuild `photos.json` and push it, to run
   every so often while `read_bibs.py` works through the rest.

2. **Match finish photos by time.** Every runner has an official finish time to the second, and
   each finish-album photo has the time it was taken. Once each camera's clock offset is worked
   out from runners already matched by bib, a runner page could show "photos taken as you crossed
   the line" even when their bib wasn't readable. Probably the most reliable source of extra matches.

3. **Estimate when each runner passed each spot (phase 4).** The same clock calibration, plus each
   runner's start and finish times and an even-pace assumption, gives an estimated time at Mile 5,
   Mile 24, etc. Where no photo of a runner was found at a point, the site could open that album
   at roughly the right moment. Helps where bibs are hidden by arms or other runners.

4. **Second pass on photos where no bib was read.** `read_bibs.py --tiles 2` found extra small
   bibs in testing. It's about 5× slower, so run it only on photos where nothing was found.

## Fixing mistakes

5. **"This is me" / "Not me" buttons on photos.** These would open a prefilled GitHub issue, as
   reporting does now. Corrections go in a `corrections.csv` that `build_index.py` applies on
   every rebuild, so fixes aren't lost when the index is rebuilt.

## Sharing

6. **Link previews.** A shared runner link currently shows the same generic preview on WhatsApp
   or Facebook. The build could create a small page per runner (about 1,000 tiny files) with
   their name and one of their photos as the preview image, which then sends people on to the
   normal page.

7. **Custom domain**, if you have one (e.g. `photos.<something>`). Just a GitHub Pages setting.

## Smaller touches

8. **Choose which photos to download** with tick boxes, rather than all or nothing.
9. **Better alt text** on photos, naming the runners in them, for screen readers.
10. **Simple visitor counts** with a privacy-friendly counter such as GoatCounter (no cookies),
    to see whether people are using the site. Optional.

## Suggested next step

Do 2 and 3 together, since they share the camera clock calibration, plus the `publish.py`
helper from 1.
