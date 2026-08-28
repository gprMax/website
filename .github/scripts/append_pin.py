#!/usr/bin/env python3
"""
Append an approved map pin to users/pins.geojson.

Reads the issue body from the ISSUE_BODY environment variable -- never
from a command line argument and never interpolated into a shell command.
An issue body is attacker-controlled text: this repository is public, so
anyone can open an issue containing a JSON block. What they cannot do is
label it, which is why the workflow gates on a label a collaborator has
to add.

Being gated by a human is not a reason to skip validation. A reviewer
approves "a pin from Trondheim", not 400 lines of JSON they have read
carefully, so the schema is enforced here: exactly the three properties
the map reads, coordinates inside the real ranges, lengths capped, and
nothing else carried through.
"""

import json
import os
import re
import sys

PINS = "users/pins.geojson"
MAX_LOCATION = 120
MAX_NOTE = 200
PLACES = 4                       # match tools/minimise_pins.py

BLOCK = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)


def die(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def extract(body):
    matches = BLOCK.findall(body or "")
    if not matches:
        die("No ```json block found in the issue body.")
    if len(matches) > 1:
        # Two blocks means someone edited the issue, and picking one for
        # them is a guess with a person's location attached.
        die(f"Found {len(matches)} json blocks; expected exactly one.")
    try:
        return json.loads(matches[0])
    except json.JSONDecodeError as e:
        die(f"The json block does not parse: {e}")


def validate(feature):
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        die("Not a GeoJSON Feature.")

    geom = feature.get("geometry")
    if not isinstance(geom, dict) or geom.get("type") != "Point":
        die("Geometry is not a Point.")

    coords = geom.get("coordinates")
    if not isinstance(coords, list) or len(coords) != 2:
        die("Coordinates must be [lon, lat].")
    try:
        lon, lat = float(coords[0]), float(coords[1])
    except (TypeError, ValueError):
        die("Coordinates are not numbers.")
    if not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
        die(f"Coordinates out of range: {lon}, {lat}")

    props = feature.get("properties")
    if not isinstance(props, dict):
        die("Missing properties.")

    allowed = {"location_name", "body", "created_at"}
    extra = set(props) - allowed
    if extra:
        die(f"Unexpected properties: {', '.join(sorted(extra))}")

    name = props.get("location_name")
    if not isinstance(name, str) or not name.strip():
        die("location_name is missing or empty.")
    # A newline here would let a crafted name forge extra key=value lines in
    # GITHUB_OUTPUT, which is a workflow-variable injection.
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in name):
        die("location_name contains control characters.")
    if len(name) > MAX_LOCATION:
        die(f"location_name is {len(name)} characters; the cap is {MAX_LOCATION}.")

    note = props.get("body", "")
    if not isinstance(note, str):
        die("body must be a string.")
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in note):
        die("body contains control characters.")
    if len(note) > MAX_NOTE:
        die(f"body is {len(note)} characters; the cap is {MAX_NOTE}.")

    created = props.get("created_at", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(created)):
        die(f"created_at must be YYYY-MM-DD, got {created!r}")

    clean = {"location_name": name.strip(), "created_at": created}
    if note.strip():
        clean["body"] = note.strip()

    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, PLACES), round(lat, PLACES)]},
        "properties": clean,
    }


def main():
    feature = validate(extract(os.environ.get("ISSUE_BODY", "")))

    with open(PINS) as fh:
        collection = json.load(fh)
    if collection.get("type") != "FeatureCollection" or not isinstance(collection.get("features"), list):
        die(f"{PINS} is not a FeatureCollection.")

    # Two people in one town are two pins, never merged: overlapping halos
    # simply render brighter, which is the honest picture. Repeat
    # submissions are the rate limiter's problem, not this script's.
    collection["features"].append(feature)

    with open(PINS, "w") as fh:
        json.dump(collection, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    name = feature["properties"]["location_name"]
    print(f"Appended: {name} at {feature['geometry']['coordinates']}")
    print(f"{PINS} now holds {len(collection['features'])} pins.")

    summary = os.environ.get("GITHUB_OUTPUT")
    if summary:
        with open(summary, "a") as fh:
            fh.write(f"location={name}\n")
            fh.write(f"total={len(collection['features'])}\n")


if __name__ == "__main__":
    main()
