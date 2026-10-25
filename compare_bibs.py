"""Compare two bib-reading results files on the photos they both cover.

Usage:
    python compare_bibs.py bibs.csv bibs_llamacpp.csv [--show N]

For checking a new model, server or prompt against the existing results: run read_bibs.py with
--limit and a new --out, then compare. Prints how often the two agree, the bibs only one of them
found, and the time per photo. Neither file is treated as correct: photos where they disagree
are listed (with Flickr links) to check by eye.
"""

import argparse
import csv
import statistics
from pathlib import Path


def load(path):
    with open(path, newline="", encoding="utf-8") as f:
        return {(r["album"], r["file"]): r for r in csv.DictReader(f)}


def bibs(row):
    return set(row["bibs"].split(";")) if row["bibs"] else set()


def seconds(rows):
    times = [float(r["seconds"]) for r in rows if r["seconds"]]
    return f"median {statistics.median(times):.1f}s, mean {statistics.mean(times):.1f}s" if times else "no times"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("a", help="results file, e.g. bibs.csv")
    parser.add_argument("b", help="results file to compare, e.g. bibs_llamacpp.csv")
    parser.add_argument("--show", type=int, default=20, help="list up to this many disagreeing photos (default 20)")
    args = parser.parse_args()

    a, b = load(args.a), load(args.b)
    na, nb = Path(args.a).name, Path(args.b).name
    shared = [k for k in a if k in b]
    if not shared:
        print("No photos in common")
        return

    same = only_a = only_b = both = 0
    differ = []
    for key in shared:
        x, y = bibs(a[key]), bibs(b[key])
        both += len(x & y)
        only_a += len(x - y)
        only_b += len(y - x)
        if x == y:
            same += 1
        else:
            differ.append((key, x - y, y - x))

    found_a, found_b = both + only_a, both + only_b
    print(f"{len(shared)} photos in both files")
    print(f"Same bibs on {same} ({same / len(shared):.0%})")
    print(f"Bibs found: {na} {found_a}, {nb} {found_b}, {both} by both")
    print(f"Only in {na}: {only_a}   only in {nb}: {only_b}")
    print(f"Time per photo: {na} {seconds(a[k] for k in shared)}; {nb} {seconds(b[k] for k in shared)}")

    if differ and args.show:
        print(f"\nDisagreements ({min(args.show, len(differ))} of {len(differ)}):")
        for key, xa, yb in differ[:args.show]:
            print(f"  {key[0]}/{key[1]}: only {na} {sorted(xa) or '-'}, only {nb} {sorted(yb) or '-'}"
                  f"  {a[key]['flickr_url']}")


if __name__ == "__main__":
    main()
