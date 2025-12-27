from __future__ import annotations

from shared.security.policy import Policy


def test_abac_restricted_denied_for_non_admin():
    claims = {"role": "READER"}
    assert (
        Policy.allowed(
            claims, "retrieval:read", resource={"classification": "restricted"}
        )
        is False
    )


def test_api_key_scopes_override():
    claims = {"role": "READER", "api_key_scopes": ["ingestion:*"]}
    assert Policy.allowed(claims, "ingestion:write", resource={}) is True
