import os
import uuid
from fastapi.testclient import TestClient


def test_end_to_end_upload_and_query():
    # Configure dev mode with auth bypass for test
    os.environ["ENV"] = "test"
    os.environ["AUTH_ALLOW_ALL"] = "1"
    os.environ["AUTH_BYPASS_TENANT"] = "00000000-0000-0000-0000-000000000001"

    from ai_core.main import app
    from shared.database.session import create_tables

    create_tables()
    client = TestClient(app)

    # Upload a small document
    content = "RAG e2e test document. Pineapples are delicious on pizza."
    kb_id = str(uuid.uuid4())
    resp = client.post(
        "/v1/tenant/upload",
        json={
            "tenant_id": os.environ["AUTH_BYPASS_TENANT"],
            "title": "e2e",
            "content": content,
            "knowledge_base_id": kb_id,
        },
    )
    assert resp.status_code in (200, 201)

    # Query should return something related
    q = client.post(
        "/v1/query",
        json={
            "tenant_id": os.environ["AUTH_BYPASS_TENANT"],
            "channel": "web",
            "message": "What fruit goes well on pizza?",
        },
    )
    assert q.status_code == 200
    data = q.json()
    assert "final_response" in data or "response" in data

