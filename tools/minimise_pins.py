#!/usr/bin/env python3
"""
Turn the full users/pins.geojson into the smallest thing the map can run on.

The full file carries seven properties per pin. The site reads three:
location_name, body, created_at (js/usermap.js and js/usage-map.js). The
other four are Padlet bookkeeping — id, subject, permalink, original_name —
and original_name in particular is a person's name. None of it is displayed,
so none of it needs to leave the private copy.

Also:
  * strips email addresses out of the free-text notes, which three of them
    contain;
  * truncates created_at to a date, which is all the map ever shows;
  * rounds coordinates to 4 dp (~11 m). Some were stored to 16 dp, which is
    sub-micrometre precision on a world map and pinpoints a building.

Usage:  python3 tools/minimise_pins.py users/pins.geojson out.geojson
"""

import json
import re
import sys

KEEP = ("location_name", "body", "created_at")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PLACES = 4


def minimise(src):
    out, scrubbed = [], 0
    for f in src["features"]:
        p, props = f["properties"], {}
        for k in KEEP:
            v = p.get(k)
            if v in (None, ""):
                continue
            if k == "body":
                v, n = EMAIL.subn("[email removed]", v)
                scrubbed += 1 if n else 0
            elif k == "created_at":
                v = str(v)[:10]
            props[k] = v
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(float(lon), PLACES), round(float(lat), PLACES)]},
            "properties": props,
        })
    return {"type": "FeatureCollection", "features": out}, scrubbed


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[-1])
    with open(sys.argv[1]) as fh:
        src = json.load(fh)
    doc, scrubbed = minimise(src)
    with open(sys.argv[2], "w") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(f"{len(doc['features'])} pins, {scrubbed} notes scrubbed of email addresses")


if __name__ == "__main__":
    main()
