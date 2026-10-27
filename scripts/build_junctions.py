import math
import sqlite3
import sys
from collections import Counter

import osmium

SRC, DST = sys.argv[1], sys.argv[2]
CLASSES = {
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
}
use = Counter()


class Count(osmium.SimpleHandler):
    def way(self, w):
        if w.tags.get("highway") in CLASSES:
            nodes = [n.ref for n in w.nodes]
            for i, n in enumerate(nodes):
                use[n] += 2 if i in (0, len(nodes) - 1) else 1


Count().apply_file(SRC)
junction = {n for n, c in use.items() if c >= 2}


def bearing(a, b):
    y = math.sin(math.radians(b.lon - a.lon)) * math.cos(math.radians(b.lat))
    x = math.cos(math.radians(a.lat)) * math.sin(math.radians(b.lat)) - math.sin(
        math.radians(a.lat)
    ) * math.cos(math.radians(b.lat)) * math.cos(math.radians(b.lon - a.lon))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


db = sqlite3.connect(DST)
db.executescript("""DROP TABLE IF EXISTS node; DROP TABLE IF EXISTS branch;
CREATE TABLE node(id INTEGER PRIMARY KEY, lat REAL, lon REAL);
CREATE TABLE branch(
    node INTEGER, way INTEGER, bearing REAL, highway TEXT, name TEXT, oneway TEXT);""")
db.executescript("""DROP TABLE IF EXISTS way; DROP TABLE IF EXISTS way_idx;
CREATE TABLE way(id INTEGER PRIMARY KEY, highway TEXT, name TEXT, ref TEXT, oneway TEXT,
    dest TEXT, poly TEXT);
CREATE VIRTUAL TABLE way_idx USING rtree(id, minlat, maxlat, minlon, maxlon);""")
nodes, branches, ways, boxes = {}, [], [], []


def encode(points):
    out, prev = [], (0, 0)
    for lat, lon in points:
        cur = (round(lat * 1e5), round(lon * 1e5))
        for delta in (cur[0] - prev[0], cur[1] - prev[1]):
            v = ~(delta << 1) if delta < 0 else delta << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev = cur
    return "".join(out)


class Collect(osmium.SimpleHandler):
    def way(self, w):
        hw = w.tags.get("highway")
        if hw not in CLASSES:
            return
        ns = list(w.nodes)
        name = w.tags.get("name:he") or w.tags.get("name") or w.tags.get("ref") or ""
        ow = w.tags.get(
            "oneway",
            "yes" if hw.startswith("motorway") or w.tags.get("junction") == "roundabout" else "no",
        )
        pts = [(n.location.lat, n.location.lon) for n in ns if n.location.valid()]
        if len(pts) >= 2:
            tags = w.tags
            dest = tags.get("destination:he") or tags.get("destination") or ""
            kind = hw + ("|rb" if tags.get("junction") == "roundabout" else "")
            ways.append((w.id, kind, name, tags.get("ref", ""), ow, dest, encode(pts)))
            lats, lons = [p[0] for p in pts], [p[1] for p in pts]
            boxes.append((w.id, min(lats), max(lats), min(lons), max(lons)))
        for i, n in enumerate(ns):
            if n.ref not in junction or not n.location.valid():
                continue
            nodes[n.ref] = (n.location.lat, n.location.lon)
            for j, dirn in ((i - 1, "in"), (i + 1, "out")):
                if 0 <= j < len(ns) and ns[j].location.valid():
                    branches.append(
                        (
                            n.ref,
                            w.id,
                            round(bearing(n.location, ns[j].location), 1),
                            hw + ("|rb" if w.tags.get("junction") == "roundabout" else ""),
                            name,
                            ow + ":" + dirn,
                        )
                    )


Collect().apply_file(SRC, locations=True)
db.executemany("INSERT INTO node VALUES(?,?,?)", ((k, *v) for k, v in nodes.items()))
db.executemany("INSERT INTO branch VALUES(?,?,?,?,?,?)", branches)
db.executemany("INSERT INTO way VALUES(?,?,?,?,?,?,?)", ways)
db.executemany("INSERT INTO way_idx VALUES(?,?,?,?,?)", boxes)
db.executescript("CREATE INDEX b_node ON branch(node); CREATE INDEX n_ll ON node(lat, lon);")
db.commit()
print(len(nodes), "junctions", len(branches), "branches")
