#!/usr/bin/env python3
"""
Append GitHub traffic data to data/clone_data.csv and data/visitor_data.csv.

Replaces scripts/collect_clones.php and collect_visitors.php, which ran as
cron on the Gandi host. Semantics deliberately match the PHP:

  * skip the current UTC day  - it is still accumulating, and a low value
    written today would never be corrected;
  * never rewrite an existing date, only append absent ones, which is what
    makes reruns idempotent;
  * columns are date,count,uniques.

One addition the PHP lacked: the run FAILS if the newest row is older than
STALE_AFTER_DAYS. GitHub keeps only 14 days of traffic data, so a silent
failure means permanent loss. It should be loud.
"""

import csv
import datetime as dt
import os
import sys
import urllib.request
import urllib.error

REPO = os.environ.get("TRAFFIC_REPO", "gprMax/gprMax")
TOKEN = os.environ.get("GH_TRAFFIC_TOKEN")
STALE_AFTER_DAYS = 13          # GitHub retains 14; fail before the edge

FEEDS = [
    ("clones", "clones", "data/clone_data.csv"),
    ("views",  "views",  "data/visitor_data.csv"),
]


def fetch(endpoint):
    url = f"https://api.github.com/repos/{REPO}/traffic/{endpoint}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gprMax-traffic-collector",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        import json
        return json.load(r)


def update(path, key, rows):
    today = dt.datetime.now(dt.timezone.utc).date()
    existing = {}
    if os.path.exists(path):
        with open(path, newline="") as fh:
            for row in csv.reader(fh):
                if row and row[0] != "date":
                    existing[row[0]] = row

    added = []
    for entry in rows.get(key, []):
        day = entry["timestamp"][:10]
        if dt.date.fromisoformat(day) >= today:
            continue                       # still accumulating
        if day in existing:
            continue                       # never rewrite
        existing[day] = [day, str(entry["count"]), str(entry["uniques"])]
        added.append(day)

    with open(path, "w", newline="") as fh:
        # csv.writer defaults to CRLF. The whole file is rewritten every run,
        # so that terminator turns two new rows into an 890-line diff and
        # makes the history unreadable. The PHP-era files were LF; stay LF.
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["date", "count", "uniques"])
        for day in sorted(existing):
            w.writerow(existing[day])

    newest = max(existing) if existing else None
    return added, newest


def main():
    if not TOKEN:
        sys.exit("GH_TRAFFIC_TOKEN is not set")

    failures = []
    for endpoint, key, path in FEEDS:
        try:
            data = fetch(endpoint)
        except urllib.error.HTTPError as e:
            sys.exit(f"{path}: GitHub API returned {e.code} {e.reason}. "
                     "The traffic endpoints need push access; the default "
                     "GITHUB_TOKEN cannot read them.")
        added, newest = update(path, key, data)
        print(f"{path}: +{len(added)} rows"
              f"{' (' + added[0] + '..' + added[-1] + ')' if added else ''}, newest {newest}")

        if newest:
            age = (dt.datetime.now(dt.timezone.utc).date() - dt.date.fromisoformat(newest)).days
            if age > STALE_AFTER_DAYS:
                failures.append(f"{path}: newest row is {age} days old "
                                f"({newest}) — GitHub only retains 14 days, so "
                                f"data is being lost permanently.")

    if failures:
        print("\n".join("ERROR: " + f for f in failures), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
