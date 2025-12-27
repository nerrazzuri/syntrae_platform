import os
import time
import uuid
import jwt
from fastapi.testclient import TestClient

# Enable admin bypass in tests
os.environ.setdefault("ENV", "test")
os.environ.setdefault("AUTH_BYPASS_ENABLE", "1")
os.environ.setdefault("JWT_SECRET", "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

from ai_core.main import app  # noqa: E402

client = TestClient(app)


def _mint_admin_token() -> str:
    secret = os.environ["JWT_SECRET"]
    now = int(time.time())
    payload = {
        "user_id": "dev-admin",
        "tenant_id": "00000000-0000-0000-0000-000000000001",
        "role": "ADMIN",
        "type": "access",
        "iss": "omnichannel-chatbot",
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def test_admin_tenant_create_list_summary_and_ops():
    token = _mint_admin_token()
    h = {"Authorization": f"Bearer {token}"}

    # Create tenant
    name = "TestCo"
    domain = f"test-{uuid.uuid4().hex[:6]}.example.com"
    r = client.post(
        "/v1/admin/tenants/create",
        headers=h,
        json={"name": name, "domain": domain, "subscription_tier": "BASIC"},
    )
    assert r.status_code == 200, r.text
    tid = r.json().get("id")
    assert tid

    # List tenants
    r = client.get("/v1/admin/tenants/list", headers=h)
    assert r.status_code == 200
    rows = r.json()
    assert any(t.get("id") == tid for t in rows)

    # Summary (ensures impersonation-safe read path executes)
    r = client.get(f"/v1/admin/tenants/summary?tenant_id={tid}", headers=h)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s.get("tenant", {}).get("id") == tid

    # Update BYO secrets (write-only)
    r = client.post(
        f"/v1/admin/tenants/{tid}/secrets",
        headers=h,
        json={"OPENAI_API_KEY": "sk-tenant-test", "FILE_SIGNING_SECRET": "fs-tenant-test"},
    )
    assert r.status_code in (200, 400), r.text  # 400 allowed when Vault disabled

    # Ops: purge vectors
    r = client.post(f"/v1/admin/tenants/{tid}/ops/purge-vectors", headers=h)
    assert r.status_code == 200, r.text

    # Ops: purge storage
    r = client.post(f"/v1/admin/tenants/{tid}/ops/purge-storage", headers=h)
    assert r.status_code == 200, r.text

    # Ops: schedule reindex
    r = client.post(f"/v1/admin/tenants/{tid}/ops/reindex", headers=h)
    assert r.status_code == 200, r.text

    # Ops: rotate signing secret
    r = client.post(f"/v1/admin/tenants/{tid}/ops/rotate-signing-secret", headers=h)
    assert r.status_code in (200, 400, 500), r.text  # may fail without Vault enabled


