from app.auth import bearer_value, ip_is_allowed, secure_equal


def test_bearer_is_case_insensitive_but_not_optional() -> None:
    assert bearer_value("Bearer abc") == "abc"
    assert bearer_value("bearer abc") == "abc"
    assert bearer_value(None) is None
    assert secure_equal("abc", "abc")
    assert not secure_equal(None, "abc")


def test_ip_allowlist_supports_cidr() -> None:
    assert ip_is_allowed("203.0.113.8", ["203.0.113.0/24"])
    assert not ip_is_allowed("198.51.100.8", ["203.0.113.0/24"])
    assert ip_is_allowed("198.51.100.8", [])
