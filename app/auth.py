from __future__ import annotations

import hmac
import ipaddress


def bearer_value(header: str | None) -> str | None:
    if not header:
        return None
    scheme, separator, token = header.partition(" ")
    if separator and scheme.lower() == "bearer" and token:
        return token
    return None


def secure_equal(actual: str | None, expected: str) -> bool:
    return actual is not None and hmac.compare_digest(actual, expected)


def ip_is_allowed(remote_ip: str | None, networks: list[str]) -> bool:
    if not networks:
        return True
    if not remote_ip:
        return False
    try:
        address = ipaddress.ip_address(remote_ip)
        return any(address in ipaddress.ip_network(item, strict=False) for item in networks)
    except ValueError:
        return False
