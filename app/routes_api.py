"""Google Routes API lookup for the navigation bot (traffic-aware driving routes)."""

from __future__ import annotations

import asyncio
import json
import urllib.request

from .config import Settings

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
FIELD_MASK = (
    "routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,"
    "routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction.instructions"
)
_credentials = {}


def _token(settings: Settings) -> tuple[str, str | None]:
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    secret = settings.google_tts_service_account_json
    if secret is None:
        raise RuntimeError("Google service account is not configured")
    creds = _credentials.get("routes")
    if creds is None:
        info = json.loads(secret.get_secret_value())
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        _credentials["routes"] = creds
        _credentials["project"] = settings.google_tts_project or info.get("project_id")
    if not creds.valid:
        creds.refresh(Request())
    return creds.token, _credentials.get("project")


def _seconds(value: str | None) -> int:
    return int(float(str(value or "0s").rstrip("s") or 0))


def summarize(result: dict, max_steps: int = 25) -> dict:
    routes = result.get("routes") or []
    if not routes:
        return {"found": False}
    route = routes[0]
    steps = []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            text = (step.get("navigationInstruction") or {}).get("instructions")
            if text:
                steps.append({"instruction": text, "meters": step.get("distanceMeters", 0)})
    return {
        "found": True,
        "via": route.get("description", ""),
        "distance_km": round(route.get("distanceMeters", 0) / 1000, 1),
        "minutes_with_traffic": round(_seconds(route.get("duration")) / 60),
        "minutes_without_traffic": round(_seconds(route.get("staticDuration")) / 60),
        "steps": steps[:max_steps],
        "more_steps": max(0, len(steps) - max_steps),
    }


def _compute_sync(settings: Settings, origin: str, destination: str) -> dict:
    token, project = _token(settings)
    headers = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": FIELD_MASK,
    }
    if project:
        headers["x-goog-user-project"] = project
    body = {
        "origin": {"address": origin},
        "destination": {"address": destination},
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "languageCode": "he",
        "regionCode": "IL",
        "units": "METRIC",
    }
    request = urllib.request.Request(
        ROUTES_URL, data=json.dumps(body).encode(), method="POST", headers=headers,
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return summarize(json.loads(response.read()))


async def compute_route(settings: Settings, origin: str, destination: str) -> dict:
    return await asyncio.to_thread(_compute_sync, settings, origin[:300], destination[:300])
