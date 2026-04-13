import jwt

from shared.security.jwt import JWTService


def test_created_tokens_use_configured_issuer(monkeypatch):
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    monkeypatch.setenv("JWT_ISSUER", "syntrae-test-issuer")

    service = JWTService()

    access_token = service.create_access_token(
        user_id="user-1",
        tenant_id="tenant-1",
        user_type="INTERNAL_STAFF",
        role="ADMIN",
    )
    refresh_token = service.create_refresh_token(
        user_id="user-1",
        tenant_id="tenant-1",
        user_type="INTERNAL_STAFF",
    )

    access_payload = jwt.decode(
        access_token,
        "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        algorithms=["HS256"],
        options={"verify_exp": False},
    )
    refresh_payload = jwt.decode(
        refresh_token,
        "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        algorithms=["HS256"],
        options={"verify_exp": False},
    )

    assert access_payload["iss"] == "syntrae-test-issuer"
    assert refresh_payload["iss"] == "syntrae-test-issuer"
