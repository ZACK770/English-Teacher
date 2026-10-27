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
    name = re.sub(r"[\"'׳״`.,\-]", "", name or "")
    name = re.sub(r"^(רחוב|רח|שדרות|שד|דרך|כביש)\s+", "", name.strip())
    return re.sub(r"\s+", " ", name).strip()


def spoken_distance(meters: float) -> str:
    if meters < 60:
        return "עכשיו"
    if meters < 1000:
        return f"בעוד {int(round(meters / 50.0) * 50)} מטר"
    return f'בעוד {meters / 1000:.1f} ק"מ'


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
            for b, hw, name, ow in self.db.execute(
                "SELECT bearing, highway, name, oneway FROM branch WHERE node=?",
                (nid,),
            ):
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

    # ---- state ----------------------------------------------------------------
    def update(
        self,
        *,
        place: str = "",
        destination: str = "",
        seen_sign: bool = False,
        odometer_km: float | None = None,
        direction: str = "",
    ) -> dict:
        notes: list[str] = []
        if destination and destination != self.destination:
            self.destination, self.route = destination, None
        if direction == "opposite" and self.heading is not None:
            self.heading = (self.heading + 180) % 360
            self.heading_confirmed, self.route = True, None
            notes.append("הכיוון התהפך לפי הנהג; חושב מסלול חדש")
        elif direction == "confirmed" and self.heading is not None:
            self.heading_confirmed = True

        fix = None
        if place:
            fix = self._locate(place, seen_sign, notes)
            if fix is None:
                return {
                    "status": "unknown_place",
                    "ask": f'לא מצאתי את "{place}" במפה. בקש מהנהג שם רחוב עם מספר בית, '
                    "צומת או מקום מוכר אחר, וגם את שם העיר.",
                }
        elif odometer_km is not None:
            fix = self._odometer(odometer_km, notes)
            if fix is None:
                return {
                    "status": "need_anchor",
                    "ask": "כדי להשתמש במד הנסיעה צריך נקודת התחלה. שאל איפה הוא נמצא עכשיו "
                    "בדיוק ומה מראה מד הנסיעה ברגע זה.",
                }
        elif odometer_km is None and place == "" and not self.fixes:
            return {
                "status": "need_position",
                "ask": "שאל את הנהג איפה הוא עכשיו: רחוב ומספר בית, צומת או מקום מוכר, ובאיזו עיר.",
            }

        if fix is not None:
            self._learn_heading(fix, notes)
            self.fixes.append(fix)
            self.fixes = self.fixes[-8:]
            if odometer_km is not None and place:
                self.odometer_base = (odometer_km, fix.along or 0.0)
        if not self.destination:
            return {
                "status": "need_destination",
                "ask": "שאל לאן נוסעים: כתובת או מקום, עם שם העיר.",
            }
        return self._guide(notes)

    def _locate(self, place: str, seen_sign: bool, notes: list[str]) -> Fix | None:
        if self.route and self.fixes:
            last_along = self.fixes[-1].along or 0.0
            ahead = self.route.slice(
                max(0.0, last_along - 150), min(self.route.length, last_along + 6000)
            )
            hit = self.junctions.crossing(ahead, place)
            if hit:
                along = max(0.0, last_along - 150) + hit[0]
                if seen_sign:
                    notes.append("השלט נראה מרחוק; מניח שהנהג עוד לפני הצומת")
                    along = max(last_along, along - 80)
                notes.append(f"זוהה הצומת עם {place} על המסלול")
                return Fix(self.route.point_at(along), time.time(), place, along)
        found = self.geocode(place)
        if not found:
            return None
        point, label, types = found
        if "route" in types and not any(ch.isdigit() for ch in place):
            notes.append("זוהה רק שם רחוב בלי מספר או צומת; המיקום משוער לאורך הרחוב")
        return Fix(point, time.time(), label)

    def _odometer(self, km: float, notes: list[str]) -> Fix | None:
        if not self.route or self.odometer_base is None:
            if self.route and self.fixes and self.fixes[-1].along is not None:
                self.odometer_base = (km, self.fixes[-1].along)
                notes.append("קריאת מד הנסיעה נשמרה כנקודת ייחוס")
                return None if not self.fixes else self.fixes[-1]
            return None
        base_km, base_along = self.odometer_base
        along = min(self.route.length, base_along + (km - base_km) * 1000)
        notes.append("מיקום לפי מד נסיעה, בהנחה שהנהג נשאר על המסלול")
        return Fix(self.route.point_at(along), time.time(), f"מד נסיעה {km}", along)

    def _learn_heading(self, fix: Fix, notes: list[str]) -> None:
        if not self.fixes:
            return
        prev = self.fixes[-1]
        gap = distance_m(prev.point, fix.point)
        if 30 < gap < 5000 and fix.at - prev.at < 1800:
            new = bearing(prev.point, fix.point)
            if self.heading is not None and abs(angle_diff(new, self.heading)) > 120:
                notes.append("הכיוון שחושב משתי הנקודות הפוך מהמסלול; חושב מחדש")
                self.route = None
            self.heading, self.heading_confirmed = new, True
            notes.append(f"כיוון הנסיעה חושב משתי נקודות: {compass_he(new)}")

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
            else:
                if fix.along is None:
                    fix.along = along
                last = [f.along for f in self.fixes[:-1] if f.along is not None]
                if last and along + 40 < last[-1]:
                    notes.append("המיקום החדש נמצא לפני המיקום הקודם על המסלול")
        if self.route is None:
            self.route = self.compute(fix.point, self.heading if self.heading_confirmed else None)
            if self.route is None:
                return {"status": "no_route", "ask": "לא נמצא מסלול. ודא את שם היעד ואת העיר."}
            fix.along = 0.0
            if status == "on_route":
                status = "route_started"
        return self._instruction(status, fix, notes)

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
        }
        first = route.steps[0] if route.steps else None
        if status in ("route_started", "off_route_rerouted", "wrong_direction_rerouted") and first:
            if first["maneuver"] == "DEPART" and not self.heading_confirmed:
                result["ask"] = (
                    'לפני ההוראה, ודא את כיוון הנסיעה. שאל את הנהג אם זה נכון: "'
                    + first["text"].splitlines()[0]
                    + '". אם הוא נוסע בכיוון ההפוך, '
                    "הפעל שוב את הכלי עם direction=opposite."
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
        extra = lines[1:]
        say += self._count_hint(step, along, gap)
        if extra:
            say += ". " + ". ".join(extra)
        result["say"] = say
        if len(upcoming) > 1 and upcoming[1]["along"] - step["along"] < 400:
            after = upcoming[1]["text"].splitlines()[0]
            result["then"] = (
                f"ומיד אחרי זה, {spoken_distance(upcoming[1]['along'] - step['along'])}: {after}"
            )
        result["confirm_with"] = "בקש מהנהג לדווח על השלט או הרחוב הבא שהוא רואה"
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
    kwargs = {
        "place": str(args.get("place") or "")[:200],
        "destination": str(args.get("destination") or "")[:200],
        "seen_sign": bool(args.get("seen_sign")),
        "direction": str(args.get("direction") or ""),
    }
    if args.get("odometer_km") not in (None, ""):
        try:
            kwargs["odometer_km"] = float(args["odometer_km"])
        except (TypeError, ValueError):
            pass
    return await asyncio.to_thread(lambda: state.update(**kwargs))
