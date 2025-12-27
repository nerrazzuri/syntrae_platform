import os
import time
import jwt
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
        "role": role,
        "type": "access",
        "iss": "omnichannel-chatbot",
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def test_signed_url_blocks_cross_tenant():
    # Fake a doc existence by writing a file on disk
    base_path = os.path.join(os.getcwd(), "storage")
    tenant_a = "00000000-0000-0000-0000-0000000000AAA1"
    doc_id = "11111111-1111-1111-1111-111111111111"
    dir_path = os.path.join(base_path, f"tenant_{tenant_a}", "documents", doc_id)
    os.makedirs(dir_path, exist_ok=True)
    fp = os.path.join(dir_path, "metadata.json")
    with open(fp, "w", encoding="utf-8") as f:
        f.write('{"ok": true}')

    # Tenant A signs a URL
    tok_a = _mint_token(tenant_a)
    r = client.get("/v1/storage/sign/metadata", headers={"Authorization": f"Bearer {tok_a}"}, params={"document_id": doc_id})
    assert r.status_code == 200
    data = r.json()

    # Tenant B attempts to use the signed URL → should fail
    tenant_b = "00000000-0000-0000-0000-0000000000BBB2"
    tok_b = _mint_token(tenant_b)
    r2 = client.get("/v1/storage/download", headers={"Authorization": f"Bearer {tok_b}"}, params={"rid": data["rid"], "exp": data["exp"], "sig": data["sig"]})
    assert r2.status_code in (401, 403)

    # Tenant A should succeed
    r3 = client.get("/v1/storage/download", headers={"Authorization": f"Bearer {tok_a}"}, params={"rid": data["rid"], "exp": data["exp"], "sig": data["sig"]})
    assert r3.status_code == 200


