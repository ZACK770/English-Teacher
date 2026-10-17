#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import ssl

from websockets.sync.client import connect


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the deployed Technoline socket")
    parser.add_argument("url", help="Deployed wss://.../v1/technoline/stream URL")
    args = parser.parse_args()
    secret = os.environ.get("TECHNOLINE_BEARER_SECRET")
    channel_id = os.environ.get("TECHNOLINE_CHANNEL_ID", "2614d922d06b4f")
    headers = {"Authorization": f"Bearer {secret}"} if secret else None
    with connect(
        args.url,
        additional_headers=headers,
        ssl=ssl.create_default_context(),
    ) as socket:
        socket.send(
            json.dumps(
                {
                    "type": "start",
                    "callId": "smoke-test",
                    "caller": "",
                    "token": channel_id,
                    "format": "pcm16;rate=8000;ch=1",
                }
            )
        )
        print("WebSocket accepted; close it before it creates a billable AI conversation.")


if __name__ == "__main__":
    main()
