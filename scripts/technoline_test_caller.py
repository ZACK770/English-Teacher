"""Check whether SpeakCall's native menu recognizes an in-band DTMF tone."""

import argparse
import io
import math
import os
import re
import struct
import time
import wave
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import requests

TARGET = "0765673575"
CALLER = "0765674688"
KEY = "2"
ROOT_ID = "10863"
EXTENSION_ID = "10876"
ROUTE = "options"
WORKER = "https://english-engine.a0527698420.workers.dev"
PBX = "https://api.tlivr.com/"
D1 = (
    "https://api.cloudflare.com/client/v4/accounts/da53b4cd888030bba791621ea1a39f8c"
    "/d1/database/240c0754-3fc2-4da9-8d6e-72df75faa3a1/query"
)
RATE = 16000
TONES = {
    digit: (low, high)
    for row, low in zip(("123A", "456B", "789C", "*0#D"), (697, 770, 852, 941), strict=True)
    for digit, high in zip(row, (1209, 1336, 1477, 1633), strict=True)
}


class CheckError(Exception):
    pass


def tone_wav(digits: str) -> bytes:
    if not digits or any(digit not in TONES for digit in digits):
        raise ValueError("Provide DTMF digits (0–9, *, #, A–D).")
    frames = bytearray(3 * RATE * 2)
    samples = RATE * 3 // 10
    for digit in digits * 2:
        low, high = TONES[digit]
        for i in range(samples):
            t = math.tau * i / RATE
            envelope = min(1, i / 80, (samples - 1 - i) / 80)
            frames.extend(struct.pack("<h", round(
                envelope * 6500 * (math.sin(low * t) + math.sin(high * t))
            )))
        frames.extend(bytes(samples * 2))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        wav.writeframes(frames)
    return output.getvalue()


def request_json(method: str, url: str, **kwargs):
    response = requests.request(method, url, timeout=15, allow_redirects=False, **kwargs)
    if response.status_code != 200:
        raise CheckError(f"API returned HTTP {response.status_code}.")
    return response.json()


def tech(method: str, endpoint: str, **kwargs):
    return request_json(method, PBX + endpoint, headers={"User-Agent": "Mozilla/5.0"}, **kwargs)


def files(api_key: str, action: str, **params):
    return tech("GET", "ivrFilesApi.php", params={"apiKey": api_key, "action": action, **params})


def campaign(api_key: str, action: str, **fields):
    return tech("POST", "campaignApi.php", json={"apiKey": api_key, "action": action, **fields})


def run_campaign(api_key: str, audio: bytes, *, demo: bool):
    return tech(
        "POST", "campaignApi.php",
        data={
            "action": "campaignRun", "apiKey": api_key, "phones": TARGET, "callId": CALLER,
            "messagesType": "audioFile", "dialRetries": "0", "betweenRetries": "20",
            "title": "SpeakCall QA - in-band DTMF", "externalID": f"dtmf-{uuid4().hex}",
            "runType": "hold", **({"demo": "yes"} if demo else {}),
        },
        files={"audioFile": ("dtmf.wav", audio, "audio/wav")},
    )


def check_route(api_key: str) -> None:
    numbers = files(api_key, "numbersList", number=TARGET)
    root = files(api_key, "folderSettings", path="/")
    child = files(api_key, "folderSettings", path=f"/{KEY}")
    allowed = files(api_key, "sipCallerIdOptions")
    menu = root.get("settings", {})
    route = child.get("settings", {}).get("url", "").split("?", 1)[0]
    if not (
        any(row.get("number") == TARGET and row.get("extensionId") == ""
            for row in numbers.get("numbers", []))
        and str(root.get("id")) == ROOT_ID and root.get("num") == TARGET
        and root.get("type") == "menu" and str(root.get("disabled")) == "0"
        and str(menu.get("maxDigits")) == "1" and str(menu.get("minDigits")) == "1"
        and menu.get("goToPath") == "" and menu.get("entryCampaign") == "no"
        and str(child.get("belowExtension")) == ROOT_ID and child.get("num") == TARGET
        and str(child.get("id")) == EXTENSION_ID and str(child.get("extension")) == KEY
        and child.get("type") == "api" and str(child.get("disabled")) == "0"
        and route == f"{WORKER}/v1/technoline/ivr/{ROUTE}"
        and any(row.get("number") == CALLER for row in allowed.get("system_numbers", []))
    ):
        raise CheckError("The target menu, Worker extension or caller ID did not match.")


def worker_event(token: str, call_id: str) -> bool:
    result = request_json(
        "POST", D1, headers={"Authorization": f"Bearer {token}"},
        json={
            "sql": """SELECT 1 FROM console_records
                      WHERE kind='ivr-events' AND json_extract(body,'$.call_id')=?
                      AND json_extract(body,'$.route')=?
                      AND coalesce(json_extract(body,'$.finished'),0)=0 LIMIT 1""",
            "params": [call_id, ROUTE],
        },
    )
    if result.get("success") is not True or result["result"][0].get("success") is not True:
        raise CheckError("D1 query was not successful.")
    return bool(result["result"][0]["results"])


def call_history(api_key: str, started: datetime):
    israel = ZoneInfo("Asia/Jerusalem")
    first_day = started.astimezone(israel).date().isoformat()
    last_day = datetime.now(israel).date().isoformat()
    history = files(
        api_key, "callHistory",
        phone=CALLER, did=TARGET, **{"from": first_day, "to": last_day},
    )
    if str(history.get("status")).casefold() != "ok" or history.get("capped") is not False:
        raise CheckError("Inbound call history is unavailable or capped.")
    return [
        row for row in history["calls"]
        if row.get("phone") == CALLER and row.get("did") == TARGET
        and int(row["start"]) >= int(started.timestamp())
    ]


def check_held_report(report: dict) -> None:
    settings = report.get("campaign", {})
    retries = str(settings.get("dialRetries"))
    if retries != "0":
        value = retries if retries.isdecimal() else "unavailable"
        raise CheckError(f"Provider dialRetries={value}; held campaign was not resumed.")
    if (
        str(settings.get("recipients")) != "1"
        or re.sub(r"\D", "", str(settings.get("callId"))) != CALLER
    ):
        raise CheckError("Provider did not confirm one recipient and the expected caller ID.")


def live_check(api_key: str, token: str, audio: bytes) -> int:
    worker_event(token, "")
    result = run_campaign(api_key, audio, demo=False)
    campaign_id = str(result.get("campaignId"))
    if str(result.get("errorCode")) != "0" or not campaign_id.isdecimal():
        raise CheckError("Held campaign creation was not confirmed. Do not retry blindly.")
    print(f"Held campaign {campaign_id}", flush=True)
    report = campaign(api_key, "campaignReport", campaignId=campaign_id)
    check_held_report(report)
    started = datetime.now(UTC)
    print(f"Resuming one dial at {started.isoformat()}; do not rerun on timeout.", flush=True)
    resumed = campaign(api_key, "campaignResumption", campaignId=campaign_id)
    if str(resumed.get("errorCode")) != "0":
        raise CheckError("Campaign resumption was not confirmed. Do not retry blindly.")
    for _ in range(8):
        time.sleep(8)
        report = campaign(api_key, "campaignReport", campaignId=campaign_id)
        if report.get("campaign", {}).get("status") == "הסתיים":
            break
    else:
        raise CheckError("Campaign did not finish within the polling limit; result inconclusive.")
    calls = report.get("calls", [])
    if len(calls) != 1 or calls[0].get("status") != "answered":
        raise CheckError("Campaign report does not confirm one answered call; result inconclusive.")
    duration = str(calls[0].get("duration"))
    if re.fullmatch(r"[0-9]+:[0-9]{2}", duration):
        print(f"Campaign report: answered, duration {duration}.")
    incoming = call_history(api_key, started)
    if len(incoming) != 1 or str(incoming[0].get("entryExt")) != ROOT_ID:
        raise CheckError("Could not identify a single incoming call into the root menu.")
    call = incoming[0]
    print(f"Call history: entry={call.get('entryName')!r}, last={call.get('lastName')!r}.")
    if worker_event(token, call["callId"]):
        print("Detected: matching Worker options event.")
        return 0
    print("No matching Worker options event; detection was not observed on this call.")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--wav", type=Path, help="Generate a WAV locally without any API access.")
    mode.add_argument("--live", action="store_true", help="Request one live call after validation.")
    parser.add_argument("--digits", default=KEY, help="DTMF sequence (only 2 for campaign modes).")
    args = parser.parse_args()
    try:
        audio = tone_wav(args.digits)
        if args.wav:
            args.wav.write_bytes(audio)
            return 0
        if args.digits != KEY:
            raise CheckError("Only key 2 is allowed in campaign mode.")
        api_key = os.environ["TLIVR_SYSTEM_API_KEY"]
        check_route(api_key)
        demo = run_campaign(api_key, audio, demo=True)
        if not (
            demo.get("campaignId") == "demo" and str(demo.get("errorCode")) == "0"
            and str(demo.get("phones")) == "1"
        ):
            code = str(demo.get("errorCode"))
            raise CheckError(f"Validation failed (code {code if code.isdecimal() else 'unknown'}).")
        billing = str(demo.get("billing"))
        if re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", billing):
            print(f"Validated one recipient at an estimated {billing} campaign units.", flush=True)
        else:
            print("Validated one recipient; estimate unavailable.", flush=True)
            if args.live:
                raise CheckError("No cost estimate; live campaign not created.")
        return live_check(api_key, os.environ["CLOUDFLARE_API_TOKEN"], audio) if args.live else 0
    except (CheckError, ValueError, KeyError, TypeError, IndexError, OSError,
            requests.RequestException) as error:
        detail = str(error) if isinstance(error, CheckError) else type(error).__name__
        print(f"Check stopped: {detail}", flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
