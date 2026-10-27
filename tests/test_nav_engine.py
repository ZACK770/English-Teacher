import sqlite3

from pydantic import SecretStr

from app import nav_engine
from app.config import Settings


def _settings(tmp_path):
    return Settings(
        admin_bearer_secret=SecretStr("x" * 40),
        gemini_api_key=SecretStr("k"),
        nav_junctions_path=tmp_path / "j.db",
    )


def _encode(points):
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


def _junction_db(path):
    db = sqlite3.connect(path)
    db.executescript(
        "CREATE TABLE node(id INTEGER PRIMARY KEY, lat REAL, lon REAL);"
        "CREATE TABLE branch(node INTEGER, way INTEGER, bearing REAL, highway TEXT,"
        " name TEXT, oneway TEXT);"
    )
    # Road runs north along lon 34.8; side streets every ~110 m.
    streets = [
        (1, 32.001, 270, "אלף", "no:out"),
        (2, 32.002, 90, "בית", "no:out"),
        (3, 32.003, 270, "גימל", "yes:in"),
        (4, 32.004, 270, "דלת", "no:out"),
        (5, 32.005, 270, "הא", "no:out"),
    ]
    for nid, lat, b, name, ow in streets:
        db.execute("INSERT INTO node VALUES(?,?,?)", (nid, lat, 34.8))
        db.execute("INSERT INTO branch VALUES(?,?,?,?,?,?)", (nid, nid, b, "residential", name, ow))
        db.execute(
            "INSERT INTO branch VALUES(?,?,?,?,?,?)", (nid, 99, 0, "tertiary", "ראשי", "no:out")
        )
    # Opposite (southbound) carriageway of a divided road, with a left street that is unreachable.
    db.execute("INSERT INTO node VALUES(6, 32.0025, 34.80008)")
    db.execute("INSERT INTO branch VALUES(6, 6, 270, 'residential', 'נגדי', 'no:out')")
    db.execute("INSERT INTO branch VALUES(6, 98, 0, 'tertiary', 'ראשי', 'yes:in')")
    db.execute("INSERT INTO branch VALUES(6, 98, 180, 'tertiary', 'ראשי', 'yes:out')")
    db.commit()


def _route_payload():
    north = [(32.0, 34.8), (32.005, 34.8)]
    west = [(32.005, 34.8), (32.005, 34.795)]
    return {
        "routes": [
            {
                "duration": "600s",
                "staticDuration": "500s",
                "legs": [
                    {
                        "steps": [
                            {
                                "polyline": {"encodedPolyline": _encode(north)},
                                "navigationInstruction": {
                                    "maneuver": "DEPART",
                                    "instructions": "התקדמו צפון על ראשי",
                                },
                            },
                            {
                                "polyline": {"encodedPolyline": _encode(west)},
                                "navigationInstruction": {
                                    "maneuver": "TURN_LEFT",
                                    "instructions": "פנו שמאלה אל הא",
                                },
                            },
                        ]
                    }
                ],
            }
        ]
    }


def _state(tmp_path, monkeypatch):
    _junction_db(tmp_path / "j.db")
    monkeypatch.setattr(nav_engine, "_junctions", None)
    state = nav_engine.new_state(_settings(tmp_path))
    places = {"התחלה": (32.0, 34.8), "קרוב": (32.0015, 34.8)}
    monkeypatch.setattr(state, "geocode", lambda text: (places[text], text, []))
    monkeypatch.setattr(
        state,
        "compute",
        lambda origin, heading: nav_engine.parse_route(_route_payload(), state.destination),
    )
    return state


def test_polyline_round_trip():
    pts = [(32.08589, 34.83235), (31.70001, 35.12002)]
    assert nav_engine.decode_polyline(_encode(pts)) == pts


def test_counts_open_left_turns_and_skips_no_entry(tmp_path, monkeypatch):
    state = _state(tmp_path, monkeypatch)
    first = state.update(place="התחלה", destination="יעד")
    assert first["status"] == "route_started"
    assert "ask" in first  # heading unknown -> must confirm direction
    assert "הרביעית שמאלה" not in first["say"]
    assert "זו הפנייה השלישית שמאלה" in first["say"]  # אלף, דלת, then הא; גימל is no-entry
    assert "גימל" in first["say"]


def test_reported_street_is_matched_on_route_and_learns_heading(tmp_path, monkeypatch):
    state = _state(tmp_path, monkeypatch)
    state.update(place="התחלה", destination="יעד")
    result = state.update(place="בית")
    assert result["status"] == "on_route"
    assert nav_engine.compass_he(state.heading) == "צפונה"
    assert "השנייה שמאלה" in result["say"]  # דלת then הא


def test_off_route_report_reroutes(tmp_path, monkeypatch):
    state = _state(tmp_path, monkeypatch)
    state.update(place="התחלה", destination="יעד")
    monkeypatch.setattr(state, "geocode", lambda text: ((32.02, 34.9), text, []))
    assert state.update(place="רחוק")["status"] == "off_route_rerouted"
