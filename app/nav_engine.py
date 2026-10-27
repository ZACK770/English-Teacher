"""Deterministic navigation state for the voice navigator.

Gemini only talks; positions, heading, route progress, turn counting and
left/right wording are computed here from Google Places/Routes and an
OpenStreetMap junction table built at image build time.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import sqlite3
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from .config import Settings
from .routes_api import ROUTES_URL, _token

PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
ROUTE_MASK = (
    "routes.duration,routes.staticDuration,routes.distanceMeters,"
    "routes.legs.steps.distanceMeters,routes.legs.steps.polyline.encodedPolyline,"
    "routes.legs.steps.navigationInstruction"
)
EARTH_M = 6371000.0
OFF_ROUTE_M = 70.0
TURN_WORDS = ("TURN", "ROUNDABOUT", "RAMP", "FORK", "UTURN", "MERGE")
ORDINALS = ["הראשונה", "השנייה", "השלישית", "הרביעית", "החמישית"]
SIDE_HE = {"left": "שמאלה", "right": "ימינה"}


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points, index, lat, lon = [], 0, 0, 0
    while index < len(encoded):
        for is_lon in (False, True):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        points.append((lat / 1e5, lon / 1e5))
    return points


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = (
        math.sin((la2 - la1) / 2) ** 2
        + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    )
    return 2 * EARTH_M * math.asin(math.sqrt(h))


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def angle_diff(a: float, b: float) -> float:
    return (a - b + 180) % 360 - 180


def compass_he(deg: float) -> str:
    names = ["צפונה", "צפון-מזרח", "מזרחה", "דרום-מזרח", "דרומה", "דרום-מערב", "מערבה", "צפון-מערב"]
    return names[round(deg / 45) % 8]


def normalize_name(name: str) -> str:
    name = re.sub(r"[\u0591-\u05c7\u200e\u200f\u202a-\u202e]", "", name or "")
    name = re.sub(r"[\"'׳״`’.,\-]", "", name)
    name = re.sub(r"^(רחוב|רח|שדרות|שד|דרך|כביש)\s+", "", name.strip())
    return re.sub(r"\s+", " ", name).strip()


def spoken_distance(meters: float) -> str:
    if meters < 60:
        return "עכשיו"
    if meters < 1000:
        return f"בעוד {int(round(meters / 50.0) * 50)} מטר"
    return f'בעוד {meters / 1000:.1f} ק"מ'


def encode_polyline(points) -> str:
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


def project_points(points, point):
    """(meters off, meters along, bearing, nearest point) of `point` on a polyline."""
    kx = math.cos(math.radians(points[0][0])) * EARTH_M * math.pi / 180
    ky = EARTH_M * math.pi / 180
    qx, qy = point[1] * kx, point[0] * ky
    best = (float("inf"), 0.0, 0.0, points[0])
    run = 0.0
    for a, b in zip(points, points[1:], strict=False):
        x1, y1, x2, y2 = a[1] * kx, a[0] * ky, b[1] * kx, b[0] * ky
        seg = math.hypot(x2 - x1, y2 - y1)
        if seg:
            t = max(0.0, min(1.0, ((qx - x1) * (x2 - x1) + (qy - y1) * (y2 - y1)) / seg**2))
            d = math.hypot(qx - x1 - t * (x2 - x1), qy - y1 - t * (y2 - y1))
            if d < best[0]:
                near = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
                best = (d, run + t * seg, bearing(a, b), near)
        run += seg
    return best


def walk(points, start_along: float, meters: float) -> tuple[float, float]:
    target, run = max(0.0, start_along + meters), 0.0
    for a, b in zip(points, points[1:], strict=False):
        seg = distance_m(a, b)
        if run + seg >= target and seg:
            t = (target - run) / seg
            return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        run += seg
    return points[-1] if meters > 0 else points[0]


@dataclass
class Route:
    points: list[tuple[float, float]]
    cum: list[float]
    steps: list[dict]  # {"along", "length", "maneuver", "text"}
    destination: str
    minutes: int = 0
    minutes_static: int = 0

    def project(self, point: tuple[float, float]) -> tuple[float, float, float]:
        """Return (meters off route, meters along route, route bearing there)."""
        lat0 = self.points[0][0]
        kx = math.cos(math.radians(lat0)) * EARTH_M * math.pi / 180
        ky = EARTH_M * math.pi / 180

        def xy(p):
            return (p[1] * kx, p[0] * ky)

        q = xy(point)
        best = (float("inf"), 0.0, 0.0)
        for i in range(len(self.points) - 1):
            (x1, y1), (x2, y2) = xy(self.points[i]), xy(self.points[i + 1])
            seg = math.hypot(x2 - x1, y2 - y1)
            if seg == 0:
                continue
            t = max(0.0, min(1.0, ((q[0] - x1) * (x2 - x1) + (q[1] - y1) * (y2 - y1)) / seg**2))
            d = math.hypot(q[0] - x1 - t * (x2 - x1), q[1] - y1 - t * (y2 - y1))
            if d < best[0]:
                best = (d, self.cum[i] + t * seg, bearing(self.points[i], self.points[i + 1]))
        return best

    def point_at(self, along: float) -> tuple[float, float]:
        for i in range(len(self.cum) - 1):
            if self.cum[i + 1] >= along:
                seg = self.cum[i + 1] - self.cum[i] or 1
                t = (along - self.cum[i]) / seg
                a, b = self.points[i], self.points[i + 1]
                return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        return self.points[-1]

    def slice(self, start: float, end: float) -> list[tuple[float, float]]:
        pts = [self.point_at(start)]
        pts += [p for p, c in zip(self.points, self.cum, strict=True) if start < c < end]
        pts.append(self.point_at(end))
        return pts

    @property
    def length(self) -> float:
        return self.cum[-1] if self.cum else 0.0


def parse_route(payload: dict, destination: str) -> Route | None:
    routes = payload.get("routes") or []
    if not routes:
        return None
    raw = routes[0]
    points: list[tuple[float, float]] = []
    steps = []
    for leg in raw.get("legs", []):
        for step in leg.get("steps", []):
            pts = decode_polyline((step.get("polyline") or {}).get("encodedPolyline", ""))
            if points and pts and points[-1] == pts[0]:
                pts = pts[1:]
            start_index = max(0, len(points) - 1)
            points.extend(pts)
            nav = step.get("navigationInstruction") or {}
            steps.append(
                {
                    "start_index": start_index,
                    "maneuver": nav.get("maneuver", ""),
                    "text": (nav.get("instructions") or "").strip(),
                }
            )
    if len(points) < 2:
        return None
    cum = [0.0]
    for a, b in zip(points, points[1:], strict=False):
        cum.append(cum[-1] + distance_m(a, b))
    for step in steps:
        step["along"] = cum[min(step.pop("start_index"), len(cum) - 1)]

    def secs(v):
        return int(float(str(v or "0s").rstrip("s") or 0))

    return Route(
        points,
        cum,
        steps,
        destination,
        round(secs(raw.get("duration")) / 60),
        round(secs(raw.get("staticDuration")) / 60),
    )


def _on_our_carriageway(rows, fwd: float) -> bool:
    """False when the node sits on the opposite carriageway of a divided road."""
    parallel = False
    for b, _, _, ow in rows:
        rel = abs(angle_diff(b, fwd))
        if 35 <= rel <= 145:
            continue
        parallel = True
        flag, _, end = ow.partition(":")
        if flag in ("-1", "reverse"):
            end = "in" if end == "out" else "out"
        elif flag not in ("yes", "1", "true"):
            return True
        if (rel < 35) == (end == "out"):
            return True
    return not parallel


class Junctions:
    """Side streets along a polyline from the OSM junction table."""

    def __init__(self, path: Path) -> None:
        self.db = (
            sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
            if Path(path).exists()
            else None
        )

    def _hits(self, points, near):
        if not self.db or len(points) < 2:
            return []
        route = Route(points, [0.0], [], "")
        for a, b in zip(points, points[1:], strict=False):
            route.cum.append(route.cum[-1] + distance_m(a, b))
        lats, lons = [p[0] for p in points], [p[1] for p in points]
        pad = 0.0005
        rows = self.db.execute(
            "SELECT id, lat, lon FROM node WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
            (min(lats) - pad, max(lats) + pad, min(lons) - pad, max(lons) + pad),
        ).fetchall()
        hits = []
        for nid, lat, lon in rows:
            off, along, fwd = route.project((lat, lon))
            if off < near:
                hits.append((along, fwd, nid, (lat, lon)))
        hits.sort()
        return hits

    def side_streets(self, points, near: float = 12.0) -> list[dict]:
        found: list[dict] = []
        for along, fwd, nid, _ in self._hits(points, near):
            rows = self.db.execute(
                "SELECT bearing, highway, name, oneway FROM branch WHERE node=?",
                (nid,),
            ).fetchall()
            if not _on_our_carriageway(rows, fwd):
                continue
            for b, hw, name, ow in rows:
                rel = angle_diff(b, fwd)
                if abs(rel) < 35 or abs(rel) > 145 or "|rb" in hw:
                    continue
                if hw.split("|")[0] in ("motorway", "trunk"):
                    continue
                side = "right" if rel > 0 else "left"
                if any(f["side"] == side and along - f["along"] < 25 for f in found[-3:]):
                    continue
                no_entry = ow.split(":")[0] in ("yes", "1", "true") and ow.endswith(":in")
                found.append({"along": along, "side": side, "name": name, "no_entry": no_entry})
        return found

    def ways_near(self, point, radius: float) -> list[dict]:
        if not self.db:
            return []
        dlat = radius / 111000
        dlon = radius / (111000 * math.cos(math.radians(point[0])))
        try:
            rows = self.db.execute(
                "SELECT w.id, w.highway, w.name, w.ref, w.oneway, w.dest, w.poly FROM way_idx i "
                "JOIN way w ON w.id = i.id WHERE i.maxlat >= ? AND i.minlat <= ? "
                "AND i.maxlon >= ? AND i.minlon <= ?",
                (point[0] - dlat, point[0] + dlat, point[1] - dlon, point[1] + dlon),
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        keys = ("id", "highway", "name", "ref", "oneway", "dest")
        out = []
        for row in rows:
            way = dict(zip(keys, row[:6], strict=True))
            way["points"] = decode_polyline(row[6])
            way["off"], way["along"], way["bearing"], way["near"] = project_points(
                way["points"], point
            )
            if way["off"] <= radius:
                out.append(way)
        out.sort(key=lambda w: w["off"])
        return out

    def street_at(self, point) -> str:
        for way in self.ways_near(point, 40):
            if way["name"] and "link" not in way["highway"]:
                return way["name"]
        return ""

    def corners(self, name: str, near, radius: float, other: str = "") -> list:
        """Junction nodes near `near` where a street named `name` (and `other`) meets."""
        wanted, second = normalize_name(name), normalize_name(other)
        if not self.db or not wanted:
            return []
        dlat = radius / 111000
        dlon = radius / (111000 * math.cos(math.radians(near[0])))
        rows = self.db.execute(
            "SELECT n.id, n.lat, n.lon, b.name FROM node n JOIN branch b ON b.node = n.id "
            "WHERE n.lat BETWEEN ? AND ? AND n.lon BETWEEN ? AND ?",
            (near[0] - dlat, near[0] + dlat, near[1] - dlon, near[1] + dlon),
        ).fetchall()
        names: dict[int, tuple[tuple[float, float], set[str]]] = {}
        for nid, lat, lon, branch_name in rows:
            names.setdefault(nid, ((lat, lon), set()))[1].add(normalize_name(branch_name))

        def match(want, have):
            return any(h and (want in h or h in want) for h in have)

        hits = [
            pt
            for pt, have in names.values()
            if match(wanted, have) and (not second or match(second, have))
        ]
        hits.sort(key=lambda pt: distance_m(pt, near))
        return hits

    def crossing(self, points, name: str, near: float = 15.0):
        """First point on the polyline where a street named `name` meets it."""
        wanted = normalize_name(name)
        if not wanted:
            return None
        for along, _, nid, location in self._hits(points, near):
            for (branch_name,) in self.db.execute("SELECT name FROM branch WHERE node=?", (nid,)):
                have = normalize_name(branch_name)
                if have and (wanted in have or have in wanted):
                    return along, location
        return None


@dataclass
class Fix:
    point: tuple[float, float]
    at: float
    label: str
    along: float | None = None


YES_WORDS = ("כן", "נכון", "בדיוק", "אכן", "בטח", "חיובי", "yes")
REPORTS = ("at", "see", "passed", "turned", "on_road")


@dataclass
class NavState:
    settings: Settings
    junctions: Junctions
    destination: str = ""
    route: Route | None = None
    heading: float | None = None
    heading_confirmed: bool = False
    fixes: list[Fix] = field(default_factory=list)
    odometer_base: tuple[float, float] | None = None  # (km reading, along meters)
    street: str = ""
    trip: list[str] = field(default_factory=list)
    asked_direction: bool = False
    cities: dict[str, tuple[float, float] | None] = field(default_factory=dict)
    google_calls: int = 0

    # ---- Google -------------------------------------------------------------
    def _post(self, url: str, body: dict, mask: str) -> dict:
        token, project = _token(self.settings)
        headers = {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "X-Goog-FieldMask": mask,
        }
        if project:
            headers["x-goog-user-project"] = project
        request = urllib.request.Request(
            url, data=json.dumps(body).encode(), method="POST", headers=headers
        )
        self.google_calls += 1
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())

    def geocode(self, text: str) -> tuple[tuple[float, float], str, list[str]] | None:
        body: dict = {"textQuery": text, "languageCode": "he", "regionCode": "IL", "pageSize": 1}
        near = self.fixes[-1].point if self.fixes else None
        if near:
            body["locationBias"] = {
                "circle": {"center": {"latitude": near[0], "longitude": near[1]}, "radius": 30000.0}
            }
        data = self._post(PLACES_URL, body, "places.location,places.formattedAddress,places.types")
        places = data.get("places") or []
        if not places:
            return None
        p = places[0]
        loc = p.get("location") or {}
        return (
            (loc["latitude"], loc["longitude"]),
            p.get("formattedAddress", text),
            p.get("types") or [],
        )

    def compute(self, origin: tuple[float, float], heading: float | None) -> Route | None:
        start: dict = {"latLng": {"latitude": origin[0], "longitude": origin[1]}}
        if heading is not None:
            start["heading"] = int(heading) % 360
        body = {
            "origin": {"location": start},
            "destination": {"address": self.destination},
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE",
            "languageCode": "he",
            "regionCode": "IL",
            "units": "METRIC",
        }
        return parse_route(self._post(ROUTES_URL, body, ROUTE_MASK), self.destination)

    def _city(self, name: str) -> tuple[float, float] | None:
        if name not in self.cities:
            found = self.geocode(name)
            self.cities[name] = found[0] if found else None
        return self.cities[name]

    # ---- helpers ----------------------------------------------------------------
    @property
    def here(self) -> Fix | None:
        return self.fixes[-1] if self.fixes else None

    def _travel_heading(self) -> float | None:
        if self.heading is not None and self.heading_confirmed:
            return self.heading
        if self.route and self.here and self.here.along is not None:
            return self.route.project(self.here.point)[2]
        return self.heading

    def _next_step(self) -> dict | None:
        if not self.route or not self.here:
            return None
        along = self.here.along or 0.0
        for step in self.route.steps:
            if step["along"] > along + 15 and step["maneuver"] not in (
                "NAME_CHANGE", "STRAIGHT", "DEPART"
            ):
                return step
        return None

    def _step_mentioning(self, name: str) -> dict | None:
        if not self.route or not self.here:
            return None
        along = self.here.along or 0.0
        digits = re.sub(r"\D", "", name)
        wanted = normalize_name(name)
        for step in self.route.steps:
            if step["along"] < along - 50 or step["along"] > along + 40000:
                continue
            text = normalize_name(step["text"])
            if (digits and re.search(rf"(?<!\d){digits}(?!\d)", text)) or (
                not digits and wanted and wanted in text
            ):
                return step
        return None

    def _log(self, text: str) -> None:
        self.trip.append(text)
        self.trip = self.trip[-12:]

    def _ask(self, status: str, question: str) -> dict:
        return {"status": status, "ask": question, "trip_so_far": self.trip[-6:]}

    # ---- state ----------------------------------------------------------------
    def update(
        self,
        *,
        report: str = "",
        place: str = "",
        destination: str = "",
        seen_sign: bool = False,
        turn: str = "",
        road: str = "",
        toward: str = "",
        odometer_km: float | None = None,
        direction: str = "",
        driver_words: str = "",
        full_route: bool = False,
    ) -> dict:
        notes: list[str] = []
        if report not in REPORTS:
            report = "see" if seen_sign else ("at" if place else "")
        if destination and destination != self.destination:
            self.destination, self.route = destination, None
            self._log(f"יעד: {destination}")
        if direction:
            words = driver_words.strip()
            if direction == "opposite" and self.heading is not None:
                self.heading = (self.heading + 180) % 360
                self.heading_confirmed, self.route = True, None
                notes.append("הכיוון התהפך לפי הנהג; חושב מסלול חדש")
                self._log("הנהג אמר שהוא נוסע בכיוון ההפוך")
            elif direction == "confirmed" and any(w in words for w in YES_WORDS):
                self.heading_confirmed = True
                self._log("הנהג אישר את כיוון הנסיעה")
            elif direction == "confirmed":
                notes.append("לא נשמע אישור מפורש מהנהג; הכיוון עדיין לא מאושר")

        if report == "see" and place:
            return self._seen(place, notes)
        if report in ("turned", "on_road"):
            fix = self._moved_onto(report, turn, road or place, toward, notes)
            if isinstance(fix, dict):
                return fix
        elif place:
            fix = self._locate(place, report == "passed", notes)
            if isinstance(fix, dict):
                return fix
        elif odometer_km is not None:
            fix = self._odometer(odometer_km, notes)
            if fix is None:
                return self._ask(
                    "need_anchor",
                    "כדי להשתמש במד הנסיעה צריך נקודת התחלה. שאל איפה הוא נמצא עכשיו "
                    "ומה מראה מד הנסיעה ברגע זה.",
                )
        else:
            fix = None
            if not self.fixes:
                return self._ask(
                    "need_position",
                    "שאל את הנהג איפה הוא עכשיו: רחוב ומספר בית, צומת או מקום מוכר, ובאיזו עיר.",
                )

        if fix is not None:
            self._learn_heading(fix, notes)
            self.fixes.append(fix)
            self.fixes = self.fixes[-8:]
            self.street = self.junctions.street_at(fix.point) or self.street
            if odometer_km is not None and place:
                self.odometer_base = (odometer_km, fix.along or 0.0)
        if not self.destination:
            return self._ask("need_destination", "שאל לאן נוסעים: כתובת או מקום, עם שם העיר.")
        result = self._guide(notes)
        if full_route and self.route:
            result["full_route"] = self._all_steps()
        return result

    # ---- interpreting reports ----------------------------------------------------
    def _locate(self, place: str, passed: bool, notes: list[str]) -> Fix | dict:
        here = self.here
        if self.route and here:
            last_along = here.along or 0.0
            start = max(0.0, last_along - 150)
            ahead = self.route.slice(start, min(self.route.length, last_along + 6000))
            hit = self.junctions.crossing(ahead, place)
            if hit:
                along = start + hit[0] + (30 if passed else 0)
                notes.append(f"זוהה הצומת עם {place} על המסלול")
                self._log(f"{'עבר את' if passed else 'נמצא ליד'} {place} (על המסלול)")
                return Fix(self.route.point_at(along), time.time(), place, along)
        if here and self.street:
            corner = self.junctions.corners(place, here.point, 2500, self.street)
            if corner:
                notes.append(f"זוהה הצומת {self.street} פינת {place}")
                self._log(f"נמצא ב{self.street} פינת {place}")
                return Fix(corner[0], time.time(), f"{self.street} פינת {place}")
        found = self.geocode(place)
        if not found:
            return self._ask(
                "unknown_place",
                f'לא מצאתי את "{place}". שאל שאלה אחת: באיזה רחוב הוא נוסע עכשיו, '
                "או מה מספר הבית או הצומת הקרובים.",
            )
        point, label, types = found
        street_only = "route" in types and not any(ch.isdigit() for ch in place)
        if street_only:
            if here:
                corner = self.junctions.corners(place, here.point, 3000)
                if corner:
                    self._log(f"נמצא ברחוב {place}, ליד המיקום הקודם")
                    return Fix(corner[0], time.time(), place)
            return self._ask(
                "need_detail",
                f"{place} הוא רחוב ארוך. שאל באיזה מספר בית או באיזו פינה הוא נמצא.",
            )
        self._log(f"נמצא ב{label}")
        return Fix(point, time.time(), label)

    def _seen(self, place: str, notes: list[str]) -> dict:
        """The driver sees a sign/street ahead: never move the position, explain it."""
        here = self.here
        if not here or not self.route:
            return self._ask("need_position", "שאל באיזה רחוב הוא נוסע עכשיו, ומאיזה כיוון.")
        along = here.along or 0.0
        step = self._next_step()
        end = step["along"] + 60 if step else self.route.length
        hit = self.junctions.crossing(self.route.slice(along, end), place)
        result = self._instruction("on_route", here, notes)
        mention = self._step_mentioning(place)
        if not hit and mention:
            self._log(f"רואה שלט {place} (על המסלול)")
            result["say"] = f"אתה בכיוון, {place} על המסלול. " + result.get("say", "")
            return result
        if hit:
            gap = hit[0]
            if step and abs(along + gap - step["along"]) < 40:
                prefix = f"אתה בכיוון. {place} זה בדיוק המקום שבו פונים. "
            else:
                prefix = f"אתה בכיוון. {place} בדרך, עוד לפני הפנייה, ממשיכים בו ישר. "
            self._log(f"רואה שלט {place} לפניו (על המסלול)")
            result["say"] = prefix + result.get("say", "")
            return result
        corner = self.junctions.corners(place, here.point, 2500, self.street)
        heading = self._travel_heading()
        if corner and heading is not None:
            ahead = abs(angle_diff(bearing(here.point, corner[0]), heading)) < 70
            turn_at = self.route.point_at(step["along"]) if step else None
            beyond = turn_at is not None and distance_m(here.point, corner[0]) > distance_m(
                here.point, turn_at
            ) + 50
            road = self.street or "הרחוב שלך"
            if not ahead:
                prefix = f"{place} מאחוריך, אתה מתרחק ממנו וזה בסדר. "
            elif beyond:
                prefix = (
                    f"{place} נמצא על {road} אחרי הפנייה שלך. אם הגעת אליו, פספסת, ותגיד לי. "
                )
            else:
                prefix = f"{place} לפני הפנייה שלך, ממשיכים בו ישר. "
            self._log(f"רואה שלט {place} ({prefix.split('.')[0]})")
            result["say"] = prefix + result.get("say", "")
            return result
        self._log(f"רואה שלט {place}, לא על המסלול")
        return self._ask(
            "unclear_sign",
            f"{place} לא נמצא על המסלול לפניו. אל תניח שהוא פנה. שאל: "
            f'"באיזה רחוב אתה נוסע עכשיו, ו{place} חוצה אותו לפניך?"',
        )

    def _moved_onto(
        self, report: str, turn: str, road: str, toward: str, notes: list[str]
    ) -> Fix | dict:
        here = self.here
        if not here or not road:
            return self._ask("need_detail", "שאל לאיזה רחוב או כביש הוא פנה, ובאיזו עיר.")
        heading = self._travel_heading()
        anchor = here.point
        wanted = normalize_name(road)
        digits = re.sub(r"\D", "", road)
        mention = self._step_mentioning(road)
        step = mention or self._next_step()
        if step and self.route:
            point = self.route.point_at(step["along"])
            if mention or distance_m(anchor, point) < 3000:
                anchor = point
                heading = self.route.project(point)[2]
        target = self._city(toward) if toward else None
        best, best_score = None, float("inf")
        radius = 3000 if report == "turned" else 8000
        for way in self.junctions.ways_near(anchor, radius):
            refs = [r.strip() for r in (way["ref"] or "").split(";")]
            name = normalize_name(way["name"])
            if not (
                (digits and digits in refs)
                or (wanted and name and (wanted in name or name in wanted))
            ):
                continue
            flag = (way["oneway"] or "no").split(":")[0]
            options = [way["bearing"]] if flag in ("yes", "1", "true") else (
                [(way["bearing"] + 180) % 360] if flag == "-1"
                else [way["bearing"], (way["bearing"] + 180) % 360]
            )
            for h in options:
                score = way["off"]
                if target:
                    score += 3 * abs(angle_diff(h, bearing(way["near"], target)))
                if heading is not None and turn in ("left", "right", "uturn"):
                    rel = angle_diff(h, heading)
                    want = {"right": 90, "left": -90, "uturn": 180}[turn]
                    score += 2 * abs(angle_diff(rel, want))
                elif heading is not None and report == "on_road" and not target:
                    score += 2 * abs(angle_diff(h, heading))
                if score < best_score:
                    best, best_score = (way, h), score
        if best is None:
            return self._ask(
                "unknown_road",
                f'לא מצאתי את "{road}" ליד המיקום הקודם. שאל מה השלט הבא שהוא רואה.',
            )
        way, h = best
        sign = 1 if abs(angle_diff(h, way["bearing"])) < 90 else -1
        point = walk(way["points"], way["along"], sign * 150)
        self.heading, self.heading_confirmed, self.route = h, True, None
        what = "פנה" if report == "turned" else "נמצא"
        side = {"right": " ימינה", "left": " שמאלה", "uturn": " בפרסה"}.get(turn, "")
        label = f"{road}" + (f" לכיוון {toward}" if toward else "")
        self._log(f"{what}{side} ל{label}, נוסע {compass_he(h)}")
        notes.append(f"מיקום חדש: {label}, נוסע {compass_he(h)}")
        return Fix(point, time.time(), label)

    def _odometer(self, km: float, notes: list[str]) -> Fix | None:
        if not self.route or self.odometer_base is None:
            if self.route and self.fixes and self.fixes[-1].along is not None:
                self.odometer_base = (km, self.fixes[-1].along)
                notes.append("קריאת מד הנסיעה נשמרה כנקודת ייחוס")
                return self.fixes[-1]
            return None
        base_km, base_along = self.odometer_base
        along = min(self.route.length, base_along + (km - base_km) * 1000)
        notes.append("מיקום לפי מד נסיעה, בהנחה שהנהג נשאר על המסלול")
        self._log(f"מד נסיעה {km}")
        return Fix(self.route.point_at(along), time.time(), f"מד נסיעה {km}", along)

    def _learn_heading(self, fix: Fix, notes: list[str]) -> None:
        if not self.fixes or self.route is None and self.heading_confirmed:
            return
        prev = self.fixes[-1]
        gap = distance_m(prev.point, fix.point)
        if 30 < gap < 5000 and fix.at - prev.at < 1800:
            new = bearing(prev.point, fix.point)
            if self.heading is not None and abs(angle_diff(new, self.heading)) > 120:
                notes.append("הכיוון שחושב משתי הנקודות הפוך מהמסלול; חושב מחדש")
                self.route = None
            self.heading, self.heading_confirmed = new, True

    def _guide(self, notes: list[str]) -> dict:
        fix = self.fixes[-1]
        status = "on_route"
        if self.route:
            off, along, route_bearing = self.route.project(fix.point)
            if off > OFF_ROUTE_M:
                status, self.route = "off_route_rerouted", None
            elif (
                fix.along is None
                and self.heading is not None
                and self.heading_confirmed
                and abs(angle_diff(self.heading, route_bearing)) > 120
            ):
                status, self.route = "wrong_direction_rerouted", None
            elif fix.along is None:
                fix.along = along
        if self.route is None:
            self.route = self.compute(fix.point, self.heading if self.heading_confirmed else None)
            if self.route is None:
                return self._ask("no_route", "לא נמצא מסלול. ודא את שם היעד ואת העיר.")
            fix.along = 0.0
            if status == "on_route":
                status = "route_started"
            self._log(f"מסלול חושב מחדש ({self.route.minutes} דק')")
        return self._instruction(status, fix, notes)

    def _all_steps(self) -> list[str]:
        along = (self.here.along if self.here else 0.0) or 0.0
        out = []
        for step in self.route.steps:
            if step["along"] > along + 15 and step["text"]:
                gap = spoken_distance(step["along"] - along)
                out.append(f"{gap}: {step['text'].splitlines()[0]}")
        return out[:25]

    def _instruction(self, status: str, fix: Fix, notes: list[str]) -> dict:
        route, along = self.route, fix.along or 0.0
        upcoming = [
            s
            for s in route.steps
            if s["along"] > along + 15
            and s["text"]
            and s["maneuver"] not in ("NAME_CHANGE", "STRAIGHT", "DEPART")
        ]
        remaining = route.length - along
        result: dict = {
            "status": status,
            "notes": notes,
            "remaining_km": round(remaining / 1000, 1),
            "minutes_with_traffic": route.minutes,
            "minutes_without_traffic": route.minutes_static,
            "trip_so_far": self.trip[-6:],
        }
        first = route.steps[0] if route.steps else None
        if (
            status != "on_route"
            and first
            and first["maneuver"] == "DEPART"
            and not self.heading_confirmed
            and not self.asked_direction
        ):
            self.asked_direction = True
            result["ask"] = (
                'קודם ודא כיוון נסיעה. שאל: "' + first["text"].splitlines()[0] + '?". '
                "אם הנהג עונה שזה הפוך, שלח direction=opposite. אם הוא מאשר, שלח "
                "direction=confirmed ואת המילים שאמר ב-driver_words."
            )
            self.heading = bearing(route.points[0], route.points[min(3, len(route.points) - 1)])
        if not upcoming:
            result["say"] = (
                "היעד ממש קרוב, הוא צריך להיות לפניך."
                if remaining < 150
                else f"להמשיך ישר עוד {spoken_distance(remaining)[5:]} עד היעד."
            )
            return result
        step = upcoming[0]
        gap = step["along"] - along
        lines = [line.strip() for line in step["text"].splitlines() if line.strip()]
        say = f"{spoken_distance(gap)}: {lines[0]}"
        say += self._count_hint(step, along, gap)
        if lines[1:]:
            say += ". " + ". ".join(lines[1:])
        result["say"] = say
        if len(upcoming) > 1 and upcoming[1]["along"] - step["along"] < 400:
            after = upcoming[1]["text"].splitlines()[0]
            result["then"] = (
                f"ומיד אחרי זה, {spoken_distance(upcoming[1]['along'] - step['along'])}: {after}"
            )
        return result

    def _count_hint(self, step: dict, along: float, gap: float) -> str:
        maneuver = step["maneuver"]
        if not maneuver.startswith("TURN") or "SLIGHT" in maneuver or gap > 1500:
            return ""
        side = "left" if "LEFT" in maneuver else "right" if "RIGHT" in maneuver else ""
        if not side:
            return ""
        streets = self.junctions.side_streets(self.route.slice(along, step["along"]))
        before = [s for s in streets if 20 < s["along"] < gap - 20 and s["side"] == side]
        open_before = [s for s in before if not s["no_entry"]]
        skipped = [s["name"] for s in before if s["no_entry"] and s["name"]]
        count = len(open_before) + 1
        if count == 1 and not before:
            hint = f". זו הפנייה הראשונה {SIDE_HE[side]} מכאן"
        elif count <= len(ORDINALS):
            hint = f". זו הפנייה {ORDINALS[count - 1]} {SIDE_HE[side]} מכאן"
        else:
            named = [s["name"] for s in open_before if s["name"]]
            hint = f". הפנייה {SIDE_HE[side]} הראשונה אחרי רחוב {named[-1]}" if named else ""
        if hint and skipped:
            hint += f" (לא סופרים את {', '.join(skipped)}: חד-סטרי בלי כניסה)"
        return hint


_junctions: Junctions | None = None


def new_state(settings: Settings) -> NavState:
    global _junctions
    if _junctions is None:
        path = settings.nav_junctions_path
        if not Path(path).is_absolute():
            path = Path(__file__).resolve().parent.parent / path
        _junctions = Junctions(path)
    return NavState(settings, _junctions)


async def run_update(state: NavState, args: dict) -> dict:
    kwargs: dict = {
        key: str(args.get(key) or "")[:200]
        for key in (
            "report", "place", "destination", "turn", "road", "toward", "direction", "driver_words"
        )
    }
    kwargs["seen_sign"] = bool(args.get("seen_sign"))
    kwargs["full_route"] = bool(args.get("full_route"))
    if args.get("odometer_km") not in (None, ""):
        try:
            kwargs["odometer_km"] = float(args["odometer_km"])
        except (TypeError, ValueError):
            pass
    return await asyncio.to_thread(lambda: state.update(**kwargs))
