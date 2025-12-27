from shared.security.policy import Policy


def test_admin_allows_restricted():
    claims = {"role": "ADMIN"}
    assert (
        Policy.allowed(claims, "ingestion:write", {"classification": "restricted"})
        is True
    )


def test_reader_denied_restricted():
    claims = {"role": "READER"}
    assert (
        Policy.allowed(claims, "retrieval:read", {"classification": "restricted"})
        is False
    )
