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
nodes, branches = {}, []


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
db.executescript("CREATE INDEX b_node ON branch(node); CREATE INDEX n_ll ON node(lat, lon);")
db.commit()
print(len(nodes), "junctions", len(branches), "branches")
