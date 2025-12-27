import os
import jwt
import time
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("ENV", "test")
os.environ.setdefault("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

from ai_core.main import app  # noqa: E402

client = TestClient(app)


def _mint_token(tenant: str, role: str = "ADMIN") -> str:
    secret = os.environ["JWT_SECRET"]
    now = int(time.time())
    payload = {
        "user_id": "dev-admin",
        "tenant_id": tenant,
        "user_type": "INTERNAL_STAFF",
        "role": role,
        "type": "access",
        "iss": "omnichannel-chatbot",
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def test_query_rejects_mismatched_tenant():
    token = _mint_token("00000000-0000-0000-0000-000000000001")
    body = {
        "tenantId": "00000000-0000-0000-0000-0000000000ABCD",  # mismatched
        "channel": "web",
        "message": "hi",
    }
    r = client.post(
        "/v1/query",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
    )
    assert r.status_code == 403
    assert "Tenant mismatch" in r.text


def test_upload_file_rejects_mismatched_tenant():
    token = _mint_token("00000000-0000-0000-0000-000000000001")
    # Minimal multipart form with wrong tenantId
    data = {
        "tenantId": (None, "00000000-0000-0000-0000-0000000000ABCD"),
        "title": (None, "Doc"),
        "knowledgeBaseId": (None, "00000000-0000-0000-0000-000000000000"),
        "file": ("test.txt", b"hello world", "text/plain"),
    }
    r = client.post(
        "/v1/tenant/upload_file",
        headers={"Authorization": f"Bearer {token}"},
        files=data,
    )
    assert r.status_code == 403
    assert "Tenant mismatch" in r.text


